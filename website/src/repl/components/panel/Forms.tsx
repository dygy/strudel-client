import cx from '@src/cx';

interface ButtonGroupProps {
  value: string;
  onChange: (key: string) => void;
  items: Record<string, string>;
}

export function ButtonGroup({ value, onChange, items }: ButtonGroupProps) {
  return (
    <div className="flex max-w-lg">
      {Object.entries(items).map(([key, label], i, arr) => (
        <button
          key={key}
          id={key}
          onClick={() => onChange(key)}
          className={cx(
            'px-3 py-2 border-b-2 h-10 whitespace-nowrap text-foreground transition-all duration-200 font-medium',
            value === key 
              ? 'border-foreground text-foreground' 
              : 'border-transparent text-foreground opacity-60 hover:opacity-100 hover:border-foreground hover:border-opacity-50',
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}