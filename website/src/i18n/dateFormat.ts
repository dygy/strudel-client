// Date formatting utilities with i18n support

export function formatDateTime(date: Date, locale: string = 'en'): string {
  const day = date.getDate().toString().padStart(2, '0');
  const year = date.getFullYear();
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  
  // Get month name in the current locale
  const monthName = date.toLocaleDateString(locale, { month: 'long' });
  
  return `${day} ${monthName} ${year} ${hours}:${minutes}`;
}

// Alternative function using Intl.DateTimeFormat for better locale support
export function formatDateTimeIntl(date: Date, locale: string = 'en'): string {
  const formatter = new Intl.DateTimeFormat(locale, {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false, // Use 24-hour format
  });
  
  return formatter.format(date);
}

// Hook to get formatted date with current locale
export function useFormattedDate() {
  return (date: Date, locale?: string) => {
    // Use the more robust Intl.DateTimeFormat approach
    return formatDateTimeIntl(date, locale);
  };
}