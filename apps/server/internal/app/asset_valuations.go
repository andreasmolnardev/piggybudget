package app

import (
	"fmt"
	"net/http"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

const assetValuationCollection = "asset_valuations"

func EnsureAssetValuationCollection(app core.App) error {
	collection, err := app.FindCollectionByNameOrId(assetValuationCollection)
	if err != nil {
		collection = core.NewBaseCollection(assetValuationCollection)
	}
	for _, field := range []core.Field{
		&core.TextField{Name: "owner", Required: true},
		&core.TextField{Name: "asset"},
		&core.TextField{Name: "position"},
		&core.TextField{Name: "source"},
		&core.NumberField{Name: "value", Required: true},
		&core.TextField{Name: "currency"},
		&core.DateField{Name: "as_of", Required: true},
		&core.TextField{Name: "notes"},
	} {
		if collection.Fields.GetByName(field.GetName()) == nil {
			collection.Fields.Add(field)
		}
	}
	ownerRule := "@request.auth.id = owner"
	collection.ListRule = &ownerRule
	collection.ViewRule = &ownerRule
	collection.CreateRule = &ownerRule
	collection.UpdateRule = &ownerRule
	collection.DeleteRule = &ownerRule
	if collection.GetIndex("idx_asset_valuations_owner_asset_date") == "" {
		collection.AddIndex("idx_asset_valuations_owner_asset_date", false, "owner, asset, as_of", "")
	}
	if collection.GetIndex("idx_asset_valuations_owner_position_date") == "" {
		collection.AddIndex("idx_asset_valuations_owner_position_date", false, "owner, position, as_of", "")
	}
	if err := app.Save(collection); err != nil {
		return fmt.Errorf("save %s collection: %w", assetValuationCollection, err)
	}
	legacy, err := app.FindRecordsByFilter(assetValuationCollection, "source = ''", "", 0, 0, nil)
	if err != nil {
		return err
	}
	for _, record := range legacy {
		source := "asset"
		if record.GetString("position") != "" {
			source = "position"
		}
		record.Set("source", source)
		if err := app.Save(record); err != nil {
			return err
		}
	}
	return nil
}

func registerAssetValuationRoutes(event *core.ServeEvent, prefix string) {
	event.Router.GET(prefix+"/assets/{id}/valuations", listAssetValuationsRoute)
	event.Router.GET(prefix+"/asset-valuations", listAssetPortfolioValuationsRoute)
}

func listAssetValuationsRoute(event *core.RequestEvent) error {
	user, err := CurrentUser(event)
	if err != nil {
		return err
	}
	asset, err := ownedFinanceRecord(event, "assets", user.Id)
	if err != nil {
		return err
	}
	if err := saveAssetValuation(event.App, user.Id, asset); err != nil {
		return err
	}
	records, err := event.App.FindRecordsByFilter(
		assetValuationCollection,
		"owner = {:owner} && source = 'asset' && asset = {:asset}",
		"-as_of,-id",
		0,
		0,
		dbx.Params{"owner": user.Id, "asset": asset.Id},
	)
	if err != nil {
		return err
	}
	result := make([]map[string]any, 0, len(records))
	for _, record := range records {
		result = append(result, record.PublicExport())
	}
	return event.JSON(http.StatusOK, result)
}

func saveAssetValuation(app core.App, owner string, asset *core.Record) error {
	date := asset.GetDateTime("as_of").Time()
	if date.IsZero() {
		date = time.Now().UTC()
	}
	date = time.Date(date.Year(), date.Month(), date.Day(), 0, 0, 0, 0, time.UTC)
	latest, err := app.FindRecordsByFilter(
		assetValuationCollection,
		"owner = {:owner} && source = 'asset' && asset = {:asset}",
		"-as_of,-id",
		1,
		0,
		dbx.Params{"owner": owner, "asset": asset.Id},
	)
	if err != nil {
		return err
	}
	if len(latest) > 0 && latest[0].GetFloat("value") == asset.GetFloat("value") &&
		latest[0].GetDateTime("as_of").Time().Format("2006-01-02") == date.Format("2006-01-02") {
		return nil
	}
	collection, err := app.FindCollectionByNameOrId(assetValuationCollection)
	if err != nil {
		return err
	}
	record := core.NewRecord(collection)
	record.Set("owner", owner)
	record.Set("asset", asset.Id)
	record.Set("source", "asset")
	record.Set("value", asset.GetFloat("value"))
	record.Set("currency", asset.GetString("currency"))
	record.Set("as_of", date)
	record.Set("notes", asset.GetString("notes"))
	return app.Save(record)
}

func saveAssetPositionValuation(app core.App, owner string, position *core.Record) error {
	date := position.GetDateTime("as_of").Time()
	if date.IsZero() {
		date = time.Now().UTC()
	}
	date = time.Date(date.Year(), date.Month(), date.Day(), 0, 0, 0, 0, time.UTC)
	latest, err := app.FindRecordsByFilter(
		assetValuationCollection,
		"owner = {:owner} && position = {:position}",
		"-as_of,-id",
		1,
		0,
		dbx.Params{"owner": owner, "position": position.Id},
	)
	if err != nil {
		return err
	}
	if len(latest) > 0 && latest[0].GetFloat("value") == position.GetFloat("value") &&
		latest[0].GetDateTime("as_of").Time().Format("2006-01-02") == date.Format("2006-01-02") {
		return nil
	}
	collection, err := app.FindCollectionByNameOrId(assetValuationCollection)
	if err != nil {
		return err
	}
	record := core.NewRecord(collection)
	record.Set("owner", owner)
	record.Set("asset", position.Id)
	record.Set("position", position.Id)
	record.Set("source", "position")
	record.Set("value", position.GetFloat("value"))
	record.Set("currency", position.GetString("currency"))
	record.Set("as_of", date)
	record.Set("notes", position.GetString("notes"))
	return app.Save(record)
}

func listAssetPortfolioValuationsRoute(event *core.RequestEvent) error {
	user, err := CurrentUser(event)
	if err != nil {
		return err
	}
	assets, err := event.App.FindRecordsByFilter("assets", "owner = {:owner}", "name", 0, 0, dbx.Params{"owner": user.Id})
	if err != nil {
		return err
	}
	for _, asset := range assets {
		if err := saveAssetValuation(event.App, user.Id, asset); err != nil {
			return err
		}
	}
	positions, err := event.App.FindRecordsByFilter("asset_positions", "owner = {:owner}", "name", 0, 0, dbx.Params{"owner": user.Id})
	if err != nil {
		return err
	}
	for _, position := range positions {
		if err := saveAssetPositionValuation(event.App, user.Id, position); err != nil {
			return err
		}
	}
	records, err := event.App.FindRecordsByFilter(
		assetValuationCollection,
		"owner = {:owner}",
		"as_of,created",
		0,
		0,
		dbx.Params{"owner": user.Id},
	)
	if err != nil {
		return err
	}
	result := make([]map[string]any, 0, len(records))
	for _, record := range records {
		result = append(result, record.PublicExport())
	}
	return event.JSON(http.StatusOK, result)
}
