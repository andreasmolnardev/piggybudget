# Bulk transaction JSON format

Use the **Bulk JSON** tab in the Add transaction modal to create several transactions at once. Paste a JSON array with 1 to 500 transaction objects.

```json
[
  {
    "date": "2026-10-25",
    "amount": 18.5,
    "type": "expense",
    "payee": "Corner market",
    "account": "Everyday checking",
    "category": "Groceries",
    "budget": "Food",
    "tags": ["home"],
    "notes": "Fruit and bread"
  },
  {
    "date": "2026-10-26",
    "amount": 2400,
    "type": "income",
    "payee": "Acme",
    "account": "Everyday checking",
    "category": "Pay"
  },
  {
    "date": "2026-10-27",
    "amount": 25,
    "type": "adjustment",
    "adjustment": "decrease",
    "payee": "Cash correction",
    "account": "Everyday checking"
  }
]
```

Each object needs `date`, `amount`, `type`, and `account`:

- `date` uses `YYYY-MM-DD`.
- `amount` is a positive number. Piggybudget stores expenses as negative amounts and income as positive amounts.
- `type` is `expense`, `income`, or `adjustment`. Adjustments default to an increase; set `adjustment` to `decrease` to lower the account balance.
- `account` is the exact account name or account ID. Use an ID if account names repeat.

Optional fields are `payee`, `description`, `category`, `budget`, `tags`, and `notes`. `budget` can be the exact budget category or its ID. Use an ID if category names repeat. `tags` must be an array of strings.

Bulk JSON does not support transfers, split transactions, recurring rules, drafts, receipt uploads, or debt tracking. The app checks the whole JSON array before it starts creating records. If a network or server error happens during import, some earlier rows may already be saved; remove those rows before retrying.
