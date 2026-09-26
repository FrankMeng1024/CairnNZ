type AsyncStorageState = Map<string, string>;

const globalState = globalThis as typeof globalThis & {
  __cairnTestAsyncStorage?: AsyncStorageState;
};

const values = globalState.__cairnTestAsyncStorage ?? new Map<string, string>();
globalState.__cairnTestAsyncStorage = values;

const AsyncStorage = {
  getItem: jest.fn(async (key: string) => values.get(key) ?? null),
  setItem: jest.fn(async (key: string, value: string) => { values.set(key, value); }),
  removeItem: jest.fn(async (key: string) => { values.delete(key); }),
  getAllKeys: jest.fn(async () => [...values.keys()]),
  multiGet: jest.fn(async (keys: string[]) => keys.map(key => [key, values.get(key) ?? null] as [string, string | null])),
  multiSet: jest.fn(async (entries: Array<[string, string]>) => {
    for (const [key, value] of entries) values.set(key, value);
  }),
  multiRemove: jest.fn(async (keys: string[]) => {
    for (const key of keys) values.delete(key);
  }),
  clear: jest.fn(async () => { values.clear(); }),
};

export default AsyncStorage;
