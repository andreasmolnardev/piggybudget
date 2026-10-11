package app

import (
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"path/filepath"
	"strings"

	"github.com/andreasmolnardev/slopstack/go/ownership"
	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/filesystem"
)

const (
	transactionAttachmentCollection = "transaction_attachments"
	transactionAttachmentMaxUpload  = 25 << 20
	transactionAttachmentMaxFile    = 5 << 20
	transactionAttachmentMaxFiles   = 5
)

var transactionAttachmentImageTypes = []string{"image/jpeg", "image/png", "image/gif", "image/webp"}

// EnsureTransactionAttachmentCollection creates or repairs the attachment
// collection without changing existing user data.
func EnsureTransactionAttachmentCollection(app core.App) error {
	collection, err := app.FindCollectionByNameOrId(transactionAttachmentCollection)
	if err != nil {
		collection = core.NewBaseCollection(transactionAttachmentCollection)
	}
	transactions, err := app.FindCollectionByNameOrId("transactions")
	if err != nil {
		return fmt.Errorf("find transactions collection: %w", err)
	}
	for _, field := range []core.Field{
		&core.TextField{Name: "owner", Required: true},
		&core.RelationField{Name: "transaction", Required: true, MaxSelect: 1, CollectionId: transactions.Id},
		&core.FileField{Name: "file", Required: true, MaxSize: transactionAttachmentMaxFile, MimeTypes: transactionAttachmentImageTypes, Protected: true},
	} {
		if collection.Fields.GetByName(field.GetName()) == nil {
			collection.Fields.Add(field)
		}
	}
	ownerRule := "@request.auth.id = owner"
	collection.ListRule = stringPointer(ownerRule)
	collection.ViewRule = stringPointer(ownerRule)
	collection.CreateRule = stringPointer(ownerRule)
	collection.UpdateRule = stringPointer(ownerRule)
	collection.DeleteRule = stringPointer(ownerRule)
	if collection.GetIndex("idx_transaction_attachments_owner_transaction") == "" {
		collection.AddIndex("idx_transaction_attachments_owner_transaction", false, "owner, transaction", "")
	}
	if err := app.Save(collection); err != nil {
		return fmt.Errorf("save %s collection: %w", transactionAttachmentCollection, err)
	}
	return nil
}

// RegisterTransactionAttachmentHooks protects direct PocketBase writes from
// linking an attachment to another user's transaction.
func RegisterTransactionAttachmentHooks(pb *pocketbase.PocketBase) {
	pb.OnRecordCreateRequest(transactionAttachmentCollection).BindFunc(func(event *core.RecordRequestEvent) error {
		if event.HasSuperuserAuth() {
			return event.Next()
		}
		if event.Auth == nil {
			return event.UnauthorizedError("authentication required", nil)
		}
		event.Record.Set("owner", event.Auth.Id)
		return validateTransactionAttachmentOwner(event, event.Record.GetString("transaction"), event.Auth.Id)
	})
	pb.OnRecordUpdateRequest(transactionAttachmentCollection).BindFunc(func(event *core.RecordRequestEvent) error {
		if event.HasSuperuserAuth() {
			return event.Next()
		}
		if event.Auth == nil || !ownership.IsOwner(event.Record.Original(), "owner", event.Auth.Id) {
			return event.ForbiddenError("attachment is not owned by the current user", nil)
		}
		event.Record.Set("owner", event.Auth.Id)
		return validateTransactionAttachmentOwner(event, event.Record.GetString("transaction"), event.Auth.Id)
	})
}

func validateTransactionAttachmentOwner(event *core.RecordRequestEvent, transactionID, owner string) error {
	transaction, err := event.App.FindRecordById("transactions", transactionID)
	if err != nil || !ownership.IsOwner(transaction, "owner", owner) {
		return event.BadRequestError("transaction is not owned by the current user", nil)
	}
	return event.Next()
}

// RegisterTransactionAttachmentRoutes adds the owner-scoped upload, list, and
// delete endpoints. Call it with the ServeEvent when wiring application routes.
func RegisterTransactionAttachmentRoutes(e *core.ServeEvent) {
	registerTransactionAttachmentRoutes(e)
}

func registerTransactionAttachmentRoutes(e *core.ServeEvent) {
	e.Router.GET("/api/finance/transactions/{transactionId}/attachments", listTransactionAttachments)
	e.Router.POST("/api/finance/transactions/{transactionId}/attachments", uploadTransactionAttachments)
	e.Router.DELETE("/api/finance/transactions/{transactionId}/attachments/{id}", deleteTransactionAttachment)
}

func listTransactionAttachments(event *core.RequestEvent) error {
	user, err := CurrentUser(event)
	if err != nil {
		return err
	}
	transaction, err := ownedTransaction(event, user.Id)
	if err != nil {
		return err
	}
	records, err := event.App.FindRecordsByFilter(transactionAttachmentCollection,
		"owner = {:owner} && transaction = {:transaction}", "id", 0, 0,
		dbx.Params{"owner": user.Id, "transaction": transaction.Id})
	if err != nil {
		return err
	}
	response := make([]map[string]any, 0, len(records))
	for _, record := range records {
		response = append(response, transactionAttachmentResponse(record))
	}
	return event.JSON(http.StatusOK, response)
}

func uploadTransactionAttachments(event *core.RequestEvent) error {
	user, err := CurrentUser(event)
	if err != nil {
		return err
	}
	transaction, err := ownedTransaction(event, user.Id)
	if err != nil {
		return err
	}
	event.Request.Body = http.MaxBytesReader(event.Response, event.Request.Body, transactionAttachmentMaxUpload)
	if err := event.Request.ParseMultipartForm(transactionAttachmentMaxUpload); err != nil {
		return event.BadRequestError("upload must be multipart form data and no larger than 25 MB", err)
	}
	if event.Request.MultipartForm != nil {
		defer event.Request.MultipartForm.RemoveAll()
	}
	files := event.Request.MultipartForm.File["files"]
	if len(files) == 0 || len(files) > transactionAttachmentMaxFiles {
		return event.BadRequestError("upload between 1 and 5 image files in the files field", nil)
	}

	definition, err := event.App.FindCollectionByNameOrId(transactionAttachmentCollection)
	if err != nil {
		return err
	}
	created := make([]*core.Record, 0, len(files))
	for _, header := range files {
		record, err := newTransactionAttachment(definition, user.Id, transaction.Id, header)
		if err != nil {
			deleteTransactionAttachmentRecords(event.App, created)
			return event.BadRequestError(err.Error(), nil)
		}
		if err := event.App.Save(record); err != nil {
			deleteTransactionAttachmentRecords(event.App, created)
			return err
		}
		created = append(created, record)
	}
	for _, record := range created {
		logDomainMutation(event, user.Id, "create", transactionAttachmentCollection, record.Id, map[string]any{
			"transaction_id": transaction.Id,
		})
	}
	response := make([]map[string]any, 0, len(created))
	for _, record := range created {
		response = append(response, transactionAttachmentResponse(record))
	}
	return event.JSON(http.StatusCreated, response)
}

func newTransactionAttachment(definition *core.Collection, owner, transaction string, header *multipart.FileHeader) (*core.Record, error) {
	if header.Size <= 0 || header.Size > transactionAttachmentMaxFile {
		return nil, fmt.Errorf("%q must be a non-empty image no larger than 5 MB", header.Filename)
	}
	file, err := header.Open()
	if err != nil {
		return nil, fmt.Errorf("could not read %q", header.Filename)
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, transactionAttachmentMaxFile+1))
	if err != nil || len(data) == 0 || len(data) > transactionAttachmentMaxFile {
		return nil, fmt.Errorf("%q must be a non-empty image no larger than 5 MB", header.Filename)
	}
	contentType := http.DetectContentType(data)
	if !isTransactionAttachmentImage(contentType) {
		return nil, fmt.Errorf("%q is not a supported image (JPEG, PNG, GIF, or WebP)", header.Filename)
	}
	name := filepath.Base(strings.TrimSpace(header.Filename))
	if name == "." || name == "" {
		name = "attachment"
	}
	upload, err := filesystem.NewFileFromBytes(data, name)
	if err != nil {
		return nil, fmt.Errorf("could not prepare %q", header.Filename)
	}
	record := core.NewRecord(definition)
	record.Set("owner", owner)
	record.Set("transaction", transaction)
	record.Set("file", upload)
	return record, nil
}

func isTransactionAttachmentImage(contentType string) bool {
	for _, allowed := range transactionAttachmentImageTypes {
		if contentType == allowed {
			return true
		}
	}
	return false
}

func deleteTransactionAttachment(event *core.RequestEvent) error {
	user, err := CurrentUser(event)
	if err != nil {
		return err
	}
	transaction, err := ownedTransaction(event, user.Id)
	if err != nil {
		return err
	}
	record, err := event.App.FindRecordById(transactionAttachmentCollection, event.Request.PathValue("id"))
	if err != nil || !ownership.IsOwner(record, "owner", user.Id) || record.GetString("transaction") != transaction.Id {
		return event.NotFoundError("transaction attachment not found", nil)
	}
	if err := event.App.Delete(record); err != nil {
		return err
	}
	logDomainMutation(event, user.Id, "delete", transactionAttachmentCollection, record.Id, map[string]any{
		"transaction_id": transaction.Id,
	})
	return event.NoContent(http.StatusNoContent)
}

func ownedTransaction(event *core.RequestEvent, owner string) (*core.Record, error) {
	record, err := event.App.FindRecordById("transactions", event.Request.PathValue("transactionId"))
	if err != nil || !ownership.IsOwner(record, "owner", owner) {
		return nil, event.NotFoundError("transaction not found", nil)
	}
	return record, nil
}

func transactionAttachmentResponse(record *core.Record) map[string]any {
	return map[string]any{
		"id":             record.Id,
		"transaction":    record.GetString("transaction"),
		"file":           record.GetString("file"),
		"collectionId":   record.Collection().Id,
		"collectionName": transactionAttachmentCollection,
	}
}

func deleteTransactionAttachmentRecords(app core.App, records []*core.Record) {
	for _, record := range records {
		_ = app.Delete(record)
	}
}
