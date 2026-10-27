import { useId } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

type TransactionCategoryInputProps = {
  value: string
  options: string[]
  onChange: (value: string) => void
}

function TransactionCategoryInput({
  value,
  options,
  onChange,
}: TransactionCategoryInputProps) {
  const listId = useId()
  const trimmedValue = value.trim()
  const categoryExists = options.some(
    (category) => category.trim().toLocaleLowerCase() === trimmedValue.toLocaleLowerCase()
  )

  return (
    <div className="grid gap-2">
      <Input
        aria-label="Transaction category"
        autoComplete="off"
        list={listId}
        onChange={(event) => onChange(event.currentTarget.value)}
        placeholder="Choose or enter a category"
        value={value}
      />
      <datalist id={listId}>
        {options.map((category) => (
          <option key={category} value={category} />
        ))}
      </datalist>
      <Button
        className="justify-start px-2"
        disabled={!trimmedValue || categoryExists}
        onClick={() => onChange(trimmedValue)}
        type="button"
        variant="ghost"
      >
        Use as a new category{trimmedValue ? `: ${trimmedValue}` : ""}
      </Button>
    </div>
  )
}

export { TransactionCategoryInput }
