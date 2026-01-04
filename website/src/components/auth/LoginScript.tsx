import { useEffect } from 'react';

export default function LoginScript() {
  useEffect(() => {
    // Dynamically import the login script
    import('/auth-login.js').catch(console.error);
  }, []);

  return null;
}