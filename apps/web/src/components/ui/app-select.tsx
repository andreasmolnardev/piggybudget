import * as React from 'react';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from './select';

type SelectChangeEvent = { target: { value: string } };

type AppSelectProps = {
  'aria-label'?: string;
  'aria-labelledby'?: string;
  autoFocus?: boolean;
  children: React.ReactNode;
  className?: string;
  defaultValue?: string;
  disabled?: boolean;
  id?: string;
  name?: string;
  onChange?: (event: SelectChangeEvent) => void;
  required?: boolean;
  title?: string;
  value?: string;
};

type OptionProps = {
  children?: React.ReactNode;
  disabled?: boolean;
  value?: string | number;
};

export type OptionEntry = { value: string; label: string };

const emptyValue = '__piggybudget_empty_option__';

function optionText(children: React.ReactNode): string {
  return React.Children.toArray(children)
    .map((child) => {
      if (typeof child === 'string' || typeof child === 'number') return child;
      if (React.isValidElement(child)) {
        return optionText((child.props as { children?: React.ReactNode }).children);
      }
      return '';
    })
    .join('');
}

function optionValue(props: OptionProps): string {
  return String(props.value ?? optionText(props.children));
}

function optionEntries(children: React.ReactNode): OptionEntry[] {
  return React.Children.toArray(children).flatMap((child) => {
    if (!React.isValidElement(child)) return [];
    if (child.type === 'option') {
      const props = child.props as OptionProps;
      return [{ value: optionValue(props), label: optionText(props.children) }];
    }
    if (child.type === 'optgroup') {
      return optionEntries((child.props as { children?: React.ReactNode }).children);
    }
    return [];
  });
}

export function selectedOptionLabel(options: OptionEntry[], value: string) {
  return options.find((option) => option.value === value)?.label ?? value;
}

function encode(value: string): string {
  return value === '' ? emptyValue : value;
}

function decode(value: string | null): string {
  return value === null || value === emptyValue ? '' : value;
}

function AppSelect({
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
  autoFocus,
  children,
  className,
  defaultValue,
  disabled,
  id,
  name,
  onChange,
  required,
  title,
  value,
}: AppSelectProps) {
  const options = optionEntries(children);
  const initialValue = defaultValue ?? options[0]?.value ?? '';
  const selectedValue = value ?? initialValue;

  const renderOption = (child: React.ReactNode, index: number) => {
    if (!React.isValidElement(child)) return null;
    if (child.type === 'option') {
      const props = child.props as OptionProps;
      const rawValue = optionValue(props);
      return (
        <SelectItem
          key={child.key ?? `${rawValue}-${index}`}
          value={encode(rawValue)}
          disabled={props.disabled}
        >
          {props.children}
        </SelectItem>
      );
    }
    if (child.type === 'optgroup') {
      const props = child.props as { children?: React.ReactNode; label?: string };
      return (
        <SelectGroup key={child.key ?? `group-${index}`}>
          {props.label && <SelectLabel>{props.label}</SelectLabel>}
          {React.Children.map(props.children, renderOption)}
        </SelectGroup>
      );
    }
    return null;
  };

  return (
    <Select
      disabled={disabled}
      name={name}
      required={required}
      value={value === undefined ? undefined : encode(value)}
      defaultValue={value === undefined ? encode(initialValue) : undefined}
      onValueChange={(nextValue) => onChange?.({ target: { value: decode(nextValue) } })}
    >
      <SelectTrigger
        id={id}
        className={`app-select-trigger ${className ?? ''}`}
        disabled={disabled}
        autoFocus={autoFocus}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        title={title}
      >
        <SelectValue>{selectedOptionLabel(options, selectedValue)}</SelectValue>
      </SelectTrigger>
      <SelectContent>{React.Children.map(children, renderOption)}</SelectContent>
    </Select>
  );
}

export { AppSelect };
