import { useEffect, useState } from 'react';

/**
 * Custom React hook to detect if code is running on the client side
 * Useful for handling SSR/hydration scenarios
 * @returns boolean indicating if running on client side
 */
export default function useClient(): boolean {
  const [client, setClient] = useState<boolean>(false);
  
  useEffect(() => {
    setClient(true);
  }, []);
  
  return client;
}