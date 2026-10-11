package app

import (
	"fmt"
	"net/http"
	"strings"

	"github.com/andreasmolnardev/slopstack/go/ownership"
	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/core"
)

const assetGroupOwnerRule = "@request.auth.id = owner"

// EnsureAssetGroupCollections adds owner-scoped groups and positions and the
// optional group link on existing assets.
func EnsureAssetGroupCollections(app core.App) error {
	definitions := []struct {
		name    string
		fields  []core.Field
		indexes []struct{ name, columns string }
	}{
		{
			name: "asset_groups",
			fields: []core.Field{
				&core.TextField{Name: "owner", Required: true},
				&core.TextField{Name: "name", Required: true},
				&core.TextField{Name: "description"},
				&core.TextField{Name: "currency"},
				&core.TextField{Name: "notes"},
				&core.BoolField{Name: "archived"},
			},
			indexes: []struct{ name, columns string }{{"idx_asset_groups_owner", "owner"}},
		},
		{
			name: "asset_positions",
			fields: []core.Field{
				&core.TextField{Name: "owner", Required: true},
				&core.TextField{Name: "group", Required: true},
				&core.TextField{Name: "name", Required: true},
				&core.TextField{Name: "type"},
				&core.NumberField{Name: "quantity"},
				&core.NumberField{Name: "value"},
				&core.TextField{Name: "currency"},
				&core.DateField{Name: "purchase_date"},
				&core.NumberField{Name: "purchase_price"},
				&core.NumberField{Name: "target_sale_price"},
				&core.DateField{Name: "as_of"},
				&core.TextField{Name: "notes"},
				&core.TextField{Name: "status"},
				&core.BoolField{Name: "archived"},
			},
			indexes: []struct{ name, columns string }{{"idx_asset_positions_owner_group", "owner, group"}},
		},
	}

	for _, definition := range definitions {
		collection, err := app.FindCollectionByNameOrId(definition.name)
		if err != nil {
			collection = core.NewBaseCollection(definition.name)
		}
		for _, field := range definition.fields {
			if collection.Fields.GetByName(field.GetName()) == nil {
				collection.Fields.Add(field)
			}
		}
		collection.ListRule = stringPointer(assetGroupOwnerRule)
		collection.ViewRule = stringPointer(assetGroupOwnerRule)
		collection.CreateRule = stringPointer(assetGroupOwnerRule)
		collection.UpdateRule = stringPointer(assetGroupOwnerRule)
		collection.DeleteRule = stringPointer(assetGroupOwnerRule)
		for _, index := range definition.indexes {
			if collection.GetIndex(index.name) == "" {
				collection.AddIndex(index.name, false, index.columns, "")
			}
		}
		if err := app.Save(collection); err != nil {
			return fmt.Errorf("save %s collection: %w", definition.name, err)
		}
	}

	assets, err := app.FindCollectionByNameOrId("assets")
	if err != nil {
		return fmt.Errorf("find assets collection: %w", err)
	}
	if assets.Fields.GetByName("asset_group") == nil {
		assets.Fields.Add(&core.TextField{Name: "asset_group"})
	}
	if err := app.Save(assets); err != nil {
		return fmt.Errorf("add asset group link: %w", err)
	}
	return nil
}

// RegisterAssetGroupHooks protects group links when clients use PocketBase's
// collection API directly instead of the custom routes.
func RegisterAssetGroupHooks(pb *pocketbase.PocketBase) {
	for _, collection := range []string{"asset_groups", "asset_positions", "assets"} {
		name := collection
		pb.OnRecordCreateRequest(name).BindFunc(func(event *core.RecordRequestEvent) error {
			if event.HasSuperuserAuth() {
				return event.Next()
			}
			if event.Auth == nil {
				return event.UnauthorizedError("authentication required", nil)
			}
			event.Record.Set("owner", event.Auth.Id)
			if err := validateAssetGroupRecordLink(event.App, name, event.Record, event.Auth.Id); err != nil {
				return event.BadRequestError(err.Error(), nil)
			}
			return event.Next()
		})
		pb.OnRecordUpdateRequest(name).BindFunc(func(event *core.RecordRequestEvent) error {
			if event.HasSuperuserAuth() {
				return event.Next()
			}
			if event.Auth == nil || !ownership.IsOwner(event.Record.Original(), "owner", event.Auth.Id) {
				return event.ForbiddenError("record is not owned by the current user", nil)
			}
			event.Record.Set("owner", event.Auth.Id)
			if err := validateAssetGroupRecordLink(event.App, name, event.Record, event.Auth.Id); err != nil {
				return event.BadRequestError(err.Error(), nil)
			}
			return event.Next()
		})
	}
}

func validateAssetGroupRecordLink(app core.App, collection string, record *core.Record, owner string) error {
	switch collection {
	case "asset_positions":
		return validateAssetGroupInput(app, collection, map[string]any{"group": record.GetString("group")}, nil, owner)
	case "assets":
		if groupID := record.GetString("asset_group"); groupID != "" {
			return validateAssetGroupOwner(app, groupID, owner)
		}
	}
	return nil
}

// RegisterAssetGroupRoutes installs protected custom CRUD routes. Call it from
// the application's ServeEvent registration alongside RegisterFinanceRoutes.
func RegisterAssetGroupRoutes(event *core.ServeEvent) {
	for _, prefix := range []string{"/api/finance", "/api"} {
		registerAssetGroupResourceRoutes(event, prefix, "asset-groups", "asset_groups")
		registerAssetGroupResourceRoutes(event, prefix, "asset-positions", "asset_positions")
		event.Router.PATCH(prefix+"/assets/{id}/group", assignAssetGroupRoute)
		event.Router.PUT(prefix+"/assets/{id}/group", assignAssetGroupRoute)
	}
}

var assetGroupFields = map[string]bool{
	"name": true, "description": true, "currency": true, "notes": true, "archived": true,
}

var assetPositionFields = map[string]bool{
	"group": true, "name": true, "type": true, "quantity": true, "value": true,
	"currency": true, "purchase_date": true, "purchase_price": true,
	"target_sale_price": true, "as_of": true, "notes": true, "status": true, "archived": true,
}

func registerAssetGroupResourceRoutes(event *core.ServeEvent, prefix, path, collection string) {
	fields := assetGroupFields
	if collection == "asset_positions" {
		fields = assetPositionFields
	}
	event.Router.GET(prefix+"/"+path, func(request *core.RequestEvent) error {
		user, err := CurrentUser(request)
		if err != nil {
			return err
		}
		records, err := request.App.FindRecordsByFilter(collection, "owner = {:owner}", "name,id", 0, 0, dbx.Params{"owner": user.Id})
		if err != nil {
			return err
		}
		result := make([]map[string]any, 0, len(records))
		for _, record := range records {
			result = append(result, record.PublicExport())
		}
		return request.JSON(http.StatusOK, result)
	})
	event.Router.POST(prefix+"/"+path, func(request *core.RequestEvent) error {
		user, err := CurrentUser(request)
		if err != nil {
			return err
		}
		input, err := assetGroupInput(request)
		if err != nil {
			return err
		}
		if err := validateAssetGroupInput(request.App, collection, input, nil, user.Id); err != nil {
			return request.BadRequestError(err.Error(), nil)
		}
		definition, err := request.App.FindCollectionByNameOrId(collection)
		if err != nil {
			return err
		}
		record := core.NewRecord(definition)
		record.Set("owner", user.Id)
		applyAssetGroupInput(record, input, fields)
		if err := request.App.Save(record); err != nil {
			return err
		}
		logDomainMutation(request, user.Id, "create", collection, record.Id, nil)
		return request.JSON(http.StatusCreated, record.PublicExport())
	})
	event.Router.GET(prefix+"/"+path+"/{id}", func(request *core.RequestEvent) error {
		user, err := CurrentUser(request)
		if err != nil {
			return err
		}
		record, err := ownedAssetGroupRecord(request, collection, user.Id)
		if err != nil {
			return err
		}
		return request.JSON(http.StatusOK, record.PublicExport())
	})
	update := func(request *core.RequestEvent) error {
		user, err := CurrentUser(request)
		if err != nil {
			return err
		}
		record, err := ownedAssetGroupRecord(request, collection, user.Id)
		if err != nil {
			return err
		}
		input, err := assetGroupInput(request)
		if err != nil {
			return err
		}
		if err := validateAssetGroupInput(request.App, collection, input, record, user.Id); err != nil {
			return request.BadRequestError(err.Error(), nil)
		}
		applyAssetGroupInput(record, input, fields)
		record.Set("owner", user.Id)
		if err := request.App.Save(record); err != nil {
			return err
		}
		logDomainMutation(request, user.Id, "update", collection, record.Id, nil)
		return request.JSON(http.StatusOK, record.PublicExport())
	}
	event.Router.PATCH(prefix+"/"+path+"/{id}", update)
	event.Router.PUT(prefix+"/"+path+"/{id}", update)
	event.Router.DELETE(prefix+"/"+path+"/{id}", func(request *core.RequestEvent) error {
		user, err := CurrentUser(request)
		if err != nil {
			return err
		}
		record, err := ownedAssetGroupRecord(request, collection, user.Id)
		if err != nil {
			return err
		}
		if collection == "asset_groups" {
			for _, linkedCollection := range []string{"assets", "asset_positions"} {
				field := "asset_group"
				if linkedCollection == "asset_positions" {
					field = "group"
				}
				linked, err := request.App.FindRecordsByFilter(linkedCollection, "owner = {:owner} && "+field+" = {:group}", "id", 1, 0, dbx.Params{"owner": user.Id, "group": record.Id})
				if err != nil {
					return err
				}
				if len(linked) > 0 {
					return request.BadRequestError("asset group has linked assets or positions", nil)
				}
			}
		}
		if err := request.App.Delete(record); err != nil {
			return err
		}
		logDomainMutation(request, user.Id, "delete", collection, record.Id, nil)
		return request.NoContent(http.StatusNoContent)
	})
}

func assignAssetGroupRoute(event *core.RequestEvent) error {
	user, err := CurrentUser(event)
	if err != nil {
		return err
	}
	asset, err := ownedAssetGroupRecord(event, "assets", user.Id)
	if err != nil {
		return err
	}
	input := map[string]any{}
	if err := event.BindBody(&input); err != nil {
		return event.BadRequestError("invalid request body", err)
	}
	groupID := ""
	if value, ok := input["asset_group"]; ok {
		groupID = stringValue(value)
	} else if value, ok := input["group"]; ok {
		groupID = stringValue(value)
	}
	if groupID != "" {
		if err := validateAssetGroupOwner(event.App, groupID, user.Id); err != nil {
			return event.BadRequestError(err.Error(), nil)
		}
	}
	asset.Set("asset_group", groupID)
	if err := event.App.Save(asset); err != nil {
		return err
	}
	metadata := map[string]any{}
	if groupID != "" {
		metadata["group_id"] = groupID
	}
	logDomainMutation(event, user.Id, "update", "assets", asset.Id, metadata)
	return event.JSON(http.StatusOK, asset.PublicExport())
}

func assetGroupInput(event *core.RequestEvent) (map[string]any, error) {
	input := map[string]any{}
	if err := event.BindBody(&input); err != nil {
		return nil, event.BadRequestError("invalid request body", err)
	}
	return input, nil
}

func applyAssetGroupInput(record *core.Record, input map[string]any, fields map[string]bool) {
	for field, value := range input {
		if fields[field] {
			record.Set(field, value)
		}
	}
}

func validateAssetGroupInput(app core.App, collection string, input map[string]any, existing *core.Record, owner string) error {
	if collection != "asset_positions" {
		return nil
	}
	groupID := ""
	if value, ok := input["group"]; ok {
		groupID = stringValue(value)
	} else if existing != nil {
		groupID = existing.GetString("group")
	}
	if groupID == "" {
		return fmt.Errorf("asset position requires a group")
	}
	return validateAssetGroupOwner(app, groupID, owner)
}

func validateAssetGroupOwner(app core.App, groupID, owner string) error {
	group, err := app.FindRecordById("asset_groups", groupID)
	if err != nil || !ownership.IsOwner(group, "owner", owner) {
		return fmt.Errorf("asset group not found")
	}
	return nil
}

func ownedAssetGroupRecord(event *core.RequestEvent, collection, owner string) (*core.Record, error) {
	record, err := event.App.FindRecordById(collection, event.Request.PathValue("id"))
	if err != nil || !ownership.IsOwner(record, "owner", owner) {
		name := strings.ReplaceAll(strings.TrimPrefix(collection, "asset_"), "_", " ")
		return nil, event.NotFoundError(name+" not found", nil)
	}
	return record, nil
}
