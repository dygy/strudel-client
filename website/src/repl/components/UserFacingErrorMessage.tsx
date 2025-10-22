interface UserFacingErrorMessageProps {
  error: Error | null;
}

export default function UserFacingErrorMessage({ error }: UserFacingErrorMessageProps) {
  if (error == null) {
    return null;
  }
  
  return (
    <div className="text-background px-2 py-1 bg-foreground w-full ml-auto">
      Error: {error.message || 'Unknown Error :-/'}
    </div>
  );
}