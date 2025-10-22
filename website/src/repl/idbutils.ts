import { registerSound, onTriggerSample } from '@strudel/webaudio';
import { isAudioFile } from './files';
import { logger } from '@strudel/core';

// Type definitions for IndexedDB utilities
interface DBConfig {
  dbName: string;
  table: string;
  columns: string[];
  version: number;
}

interface SoundFile {
  id: string;
  title: string;
  blob: Blob;
}

interface ProcessedFile {
  title: string;
  blob: Blob;
  id: string;
}

// Utilities for writing and reading to the IndexedDB
export const userSamplesDBConfig: DBConfig = {
  dbName: 'samples',
  table: 'usersamples',
  columns: ['blob', 'title'],
  version: 1,
};

/**
 * Deletes all IndexedDB databases - useful for debugging
 */
function clearAllIDB(): void {
  if (typeof window === 'undefined') return;
  
  window.indexedDB
    .databases()
    .then((databases) => {
      for (let i = 0; i < databases.length; i++) {
        if (databases[i].name) {
          clearIDB(databases[i].name!);
        }
      }
    })
    .then(() => {
      alert('All data cleared.');
    });
}

/**
 * Deletes a specific IndexedDB database
 * @param dbName - Name of the database to delete
 */
export function clearIDB(dbName: string): IDBOpenDBRequest {
  return window.indexedDB.deleteDatabase(dbName);
}

/**
 * Queries the DB and registers the sounds so they can be played
 * @param config - Database configuration
 * @param onComplete - Callback function to run when complete
 */
export function registerSamplesFromDB(
  config: DBConfig = userSamplesDBConfig,
  onComplete: () => void = () => {}
): void {
  openDB(config, (objectStore) => {
    const query = objectStore.getAll();
    
    query.onerror = (e) => {
      logger('User Samples failed to load ', 'error');
      onComplete();
      console.error((e?.target as IDBRequest)?.error);
    };

    query.onsuccess = (event) => {
      const soundFiles: SoundFile[] = (event.target as IDBRequest).result;
      if (!soundFiles?.length) {
        onComplete();
        return;
      }
      
      const sounds = new Map<string, Map<string, string>>();

      Promise.all(
        [...soundFiles]
          .sort((a, b) => a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: 'base' }))
          .map((soundFile) => {
            const title = soundFile.title;
            if (!isAudioFile(title)) {
              return Promise.resolve();
            }
            
            const splitRelativePath = soundFile.id.split('/');
            let parentDirectory =
              // Fallback to file name before period and separator if no parent directory
              splitRelativePath[splitRelativePath.length - 2] ?? soundFile.id.split(/\W+/)[0] ?? 'user';
            const blob = soundFile.blob;

            return blobToDataUrl(blob).then((soundPath) => {
              const titlePathMap = sounds.get(parentDirectory) ?? new Map<string, string>();
              titlePathMap.set(title, soundPath);
              sounds.set(parentDirectory, titlePathMap);
            });
          })
          .filter(Boolean)
      )
        .then(() => {
          sounds.forEach((titlePathMap, key) => {
            const value = Array.from(titlePathMap.keys())
              .sort((a, b) => a.localeCompare(b))
              .map((title) => titlePathMap.get(title)!);

            // Equivalent to registerSampleSource(key, value, { prebake: false })
            registerSound(key, (t, hapValue, onended) => onTriggerSample(t, hapValue, onended, value), {
              type: 'sample',
              samples: value,
              prebake: false,
            });
          });

          logger('imported sounds registered!', 'success');
          onComplete();
        })
        .catch((error) => {
          logger('Something went wrong while registering saved samples from the index db', 'error');
          console.error(error);
          onComplete();
        });
    };
  });
}

/**
 * Converts a Blob to a data URL
 * @param blob - The blob to convert
 * @returns Promise that resolves to the data URL
 */
async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = function (event) {
      resolve(event.target!.result as string);
    };
    reader.readAsDataURL(blob);
  });
}

/**
 * Opens IndexedDB and initializes it if necessary
 * @param config - Database configuration
 * @param onOpened - Callback function when database is opened
 */
function openDB(
  config: DBConfig,
  onOpened: (objectStore: IDBObjectStore, db: IDBDatabase) => void
): IDBOpenDBRequest | undefined {
  const { dbName, version, table, columns } = config;
  
  if (typeof window === 'undefined') {
    return;
  }
  
  if (!('indexedDB' in window)) {
    logger('IndexedDB is not supported', 'warning');
    return;
  }
  
  const dbOpen = indexedDB.open(dbName, version);

  dbOpen.onupgradeneeded = () => {
    const db = dbOpen.result;
    const objectStore = db.createObjectStore(table, { keyPath: 'id', autoIncrement: false });
    columns.forEach((column) => {
      objectStore.createIndex(column, column, { unique: false });
    });
  };
  
  dbOpen.onerror = (err) => {
    logger('Something went wrong while trying to open the client DB', 'error');
    console.error(`indexedDB error: ${(err.target as IDBRequest)?.error}`);
  };

  dbOpen.onsuccess = () => {
    const db = dbOpen.result;
    // Lock store for writing
    const writeTransaction = db.transaction([table], 'readwrite');
    // Get object store
    const objectStore = writeTransaction.objectStore(table);
    onOpened(objectStore, db);
  };
  
  return dbOpen;
}

/**
 * Processes uploaded files for IndexedDB storage
 * @param files - FileList of uploaded files
 * @returns Promise that resolves to processed files
 */
async function processFilesForIDB(files: FileList): Promise<(ProcessedFile | undefined)[]> {
  return Promise.all(
    Array.from(files)
      .map((file) => {
        const title = file.name;

        if (!isAudioFile(title)) {
          return Promise.resolve(undefined);
        }
        
        // Create obscured URL to file system that can be fetched
        const sUrl = URL.createObjectURL(file);
        
        // Fetch the sound and turn it into a blob
        return fetch(sUrl).then((res) => {
          return res.blob().then((blob) => {
            const path = (file as any).webkitRelativePath as string | undefined;
            const id = path?.length ? path : title;
            
            if (id == null || title == null || blob == null) {
              return undefined;
            }
            
            return {
              title,
              blob,
              id,
            };
          });
        });
      })
  ).catch((error) => {
    logger('Something went wrong while processing uploaded files', 'error');
    console.error(error);
    return [];
  });
}

/**
 * Uploads samples to IndexedDB
 * @param config - Database configuration
 * @param files - FileList of files to upload
 */
export async function uploadSamplesToDB(config: DBConfig, files: FileList): Promise<void> {
  logger('processing user samples...');
  
  const processedFiles = await processFilesForIDB(files);
  logger('user samples processed... opening db');
  
  const onOpened = (objectStore: IDBObjectStore) => {
    logger('index db opened... writing files to db');
    processedFiles.forEach((file) => {
      if (file != null) {
        objectStore.put(file);
      }
    });
    logger('user samples written successfully');
  };
  
  openDB(config, onOpened);
}