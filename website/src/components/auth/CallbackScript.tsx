import { useEffect } from 'react';

export default function CallbackScript() {
  useEffect(() => {
    // Dynamically import the callback script
    import('/auth-callback.js').catch(console.error);
  }, []);

  return null;
}