package app

import (
	"bytes"
	"encoding/json"
	"image"
	"image/png"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
)

func TestEnsureTransactionAttachmentCollectionIsOwnerScopedAndProtected(t *testing.T) {
	testApp, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer testApp.Cleanup()
	if err := EnsureCollections(testApp); err != nil {
		t.Fatal(err)
	}

	if err := EnsureTransactionAttachmentCollection(testApp); err != nil {
		t.Fatal(err)
	}
	collection, err := testApp.FindCollectionByNameOrId(transactionAttachmentCollection)
	if err != nil {
		t.Fatal(err)
	}
	transactionOwnerRule := "@request.auth.id = owner"
	for _, rule := range []*string{collection.ListRule, collection.ViewRule, collection.CreateRule, collection.UpdateRule, collection.DeleteRule} {
		if rule == nil || *rule != transactionOwnerRule {
			t.Fatalf("attachment rule = %v, want %q", rule, transactionOwnerRule)
		}
	}
	transaction, ok := collection.Fields.GetByName("transaction").(*core.RelationField)
	if !ok || transaction.CollectionId == "" || transaction.MaxSelect != 1 {
		t.Fatalf("attachment transaction field = %#v", collection.Fields.GetByName("transaction"))
	}
	file, ok := collection.Fields.GetByName("file").(*core.FileField)
	if !ok || !file.Protected || !file.Required || file.MaxSize != transactionAttachmentMaxFile {
		t.Fatalf("attachment file field = %#v", collection.Fields.GetByName("file"))
	}
	if len(file.MimeTypes) != len(transactionAttachmentImageTypes) {
		t.Fatalf("file MIME types = %#v", file.MimeTypes)
	}
}

func TestTransactionAttachmentHTTPRoutesScopeUploadsToTransactionOwner(t *testing.T) {
	pb := pocketbase.NewWithConfig(pocketbase.Config{
		DefaultDataDir:       t.TempDir(),
		DefaultDev:           false,
		DefaultEncryptionEnv: "pb_attachment_test_env",
	})
	if err := pb.Bootstrap(); err != nil {
		t.Fatal(err)
	}
	if err := EnsureCollections(pb); err != nil {
		t.Fatal(err)
	}
	if err := EnsureTransactionAttachmentCollection(pb); err != nil {
		t.Fatal(err)
	}
	router, err := apis.NewRouter(pb)
	if err != nil {
		t.Fatal(err)
	}
	RegisterTransactionAttachmentRoutes(&core.ServeEvent{App: pb, Router: router, Server: &http.Server{}})
	handler, err := router.BuildMux()
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(handler)
	defer func() {
		server.Close()
		pb.ResetBootstrapState()
	}()
	integration := &httpIntegrationServer{app: pb, server: server, client: server.Client()}

	owner := integrationUser(t, pb, "attachment-owner@example.com")
	other := integrationUser(t, pb, "attachment-other@example.com")
	account := financeTestRecord(t, pb, "accounts", map[string]any{"owner": owner.Id, "name": "Checking"})
	transaction := financeTestRecord(t, pb, "transactions", map[string]any{
		"owner": owner.Id, "account": account.Id, "date": "2026-10-01 00:00:00.000Z", "amount": -12.5,
	})
	ownerToken := authToken(t, integration, owner.GetString("email"))
	otherToken := authToken(t, integration, other.GetString("email"))

	var imageData bytes.Buffer
	if err := png.Encode(&imageData, image.NewRGBA(image.Rect(0, 0, 1, 1))); err != nil {
		t.Fatal(err)
	}
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	part, err := writer.CreateFormFile("files", "receipt.png")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := part.Write(imageData.Bytes()); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	request, err := http.NewRequest(http.MethodPost, server.URL+"/api/finance/transactions/"+transaction.Id+"/attachments", &body)
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Authorization", "Bearer "+ownerToken)
	request.Header.Set("Content-Type", writer.FormDataContentType())
	response, err := server.Client().Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusCreated {
		t.Fatalf("upload status = %d", response.StatusCode)
	}
	var attachments []map[string]any
	if err := json.NewDecoder(response.Body).Decode(&attachments); err != nil {
		t.Fatal(err)
	}
	if len(attachments) != 1 {
		t.Fatalf("uploaded attachments = %#v", attachments)
	}
	storedFile, _ := attachments[0]["file"].(string)
	if !strings.HasPrefix(storedFile, "receipt_") || !strings.HasSuffix(storedFile, ".png") {
		t.Fatalf("uploaded attachments = %#v", attachments)
	}
	attachmentID := attachments[0]["id"].(string)
	assertAuditEvent(t, pb, owner.Id, "create", transactionAttachmentCollection, attachmentID)

	path := "/api/finance/transactions/" + transaction.Id + "/attachments"
	status, _, listing := integrationRequest(t, integration, http.MethodGet, path, "", bearerHeaders(ownerToken))
	if status != http.StatusOK || !strings.Contains(listing, "receipt_") {
		t.Fatalf("owner attachment list = %d, %s", status, listing)
	}
	status, _, _ = integrationRequest(t, integration, http.MethodGet, path, "", bearerHeaders(otherToken))
	if status != http.StatusNotFound {
		t.Fatalf("other user's transaction attachment list = %d, want 404", status)
	}
	status, _, _ = integrationRequest(t, integration, http.MethodDelete, path+"/"+attachmentID, "", bearerHeaders(otherToken))
	if status != http.StatusNotFound {
		t.Fatalf("other user's attachment delete = %d, want 404", status)
	}
	status, _, _ = integrationRequest(t, integration, http.MethodDelete, path+"/"+attachmentID, "", bearerHeaders(ownerToken))
	if status != http.StatusNoContent {
		t.Fatalf("owner attachment delete = %d, want 204", status)
	}
	assertAuditEvent(t, pb, owner.Id, "delete", transactionAttachmentCollection, attachmentID)
}
