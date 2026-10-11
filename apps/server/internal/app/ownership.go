package app

import (
	"fmt"

	"github.com/andreasmolnardev/slopstack/go/ownership"
	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/core"
)

// registerOwnershipHooks delegates owner assignment and checks to Slopstack,
// while keeping Piggybudget's container, contact, and cascade rules local.
func registerOwnershipHooks(pb *pocketbase.PocketBase) error {
	validateEntry := func(event *core.RecordRequestEvent) error {
		collection := event.Collection.Name
		if err := validateEntryContainer(event.App, collection, event.Record.GetString(containerField(collection)), event.Auth.Id); err != nil {
			return event.BadRequestError(err.Error(), nil)
		}
		return nil
	}
	validateDeleteContainer := func(event *core.RecordRequestEvent) error {
		collection := event.Collection.Name
		field := containerField(nameForEntryCollection(collection))
		entries, err := event.App.FindRecordsByFilter(nameForEntryCollection(collection), field+" = {:container}", "", 1, 0, dbx.Params{"container": event.Record.Id})
		if err != nil {
			return err
		}
		if len(entries) > 0 {
			return event.BadRequestError("non-empty containers must be archived", nil)
		}
		return nil
	}
	validateEventDelete := func(event *core.RecordRequestEvent) error {
		if event.Record.GetString("recurrence_parent") != "" {
			return nil
		}
		overrides, err := event.App.FindRecordsByFilter("events", "owner = {:owner} && recurrence_parent = {:parent}", "id", 0, 0, dbx.Params{
			"owner": event.Record.GetString("owner"), "parent": event.Record.Id,
		})
		if err != nil {
			return err
		}
		for _, override := range overrides {
			if err := event.App.Delete(override); err != nil {
				return err
			}
		}
		return nil
	}
	validateContact := func(event *core.RecordRequestEvent) error {
		if err := validateAddressBook(event.App, event.Record.GetString("address_book"), event.Auth.Id); err != nil {
			return event.BadRequestError(err.Error(), nil)
		}
		return nil
	}

	policies := []ownership.Policy{
		{Collection: "todos", OwnerField: "owner", AllowSuperusers: true, ValidateCreate: validateEntry, ValidateUpdate: validateEntry},
		{Collection: "events", OwnerField: "owner", AllowSuperusers: true, ValidateCreate: validateEntry, ValidateUpdate: validateEntry, ValidateDelete: validateEventDelete},
		{Collection: "lists", OwnerField: "owner", AllowSuperusers: true, ValidateDelete: validateDeleteContainer},
		{Collection: "calendars", OwnerField: "owner", AllowSuperusers: true, ValidateDelete: validateDeleteContainer},
		{Collection: "contacts", OwnerField: "owner", AllowSuperusers: true, ValidateCreate: validateContact, ValidateUpdate: validateContact},
	}
	return ownership.RegisterRequestHooks(pb, policies...)
}

func validateAddressBook(app core.App, addressBookID, owner string) error {
	if addressBookID == "" {
		return fmt.Errorf("address_book is required")
	}
	book, err := app.FindRecordById("address_books", addressBookID)
	if err != nil || book.GetString("owner") != owner {
		return fmt.Errorf("address book not found")
	}
	return nil
}

func containerField(collection string) string {
	if collection == "events" || collection == "calendars" {
		return "calendar"
	}
	return "list"
}

func nameForEntryCollection(container string) string {
	if container == "calendars" {
		return "events"
	}
	return "todos"
}

func validateEntryContainer(app core.App, entryCollection, containerID, owner string) error {
	if containerID == "" {
		return fmt.Errorf("%s is required", containerField(entryCollection))
	}
	containerCollection := "lists"
	if entryCollection == "events" {
		containerCollection = "calendars"
	}
	container, err := app.FindRecordById(containerCollection, containerID)
	if err != nil || container.GetString("owner") != owner {
		return fmt.Errorf("container not found")
	}
	if container.GetBool("archived") {
		return fmt.Errorf("container is archived")
	}
	return nil
}
