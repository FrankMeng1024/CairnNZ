type TestFsState = {
  files: Map<string, string>;
  directories: Set<string>;
};

const globalState = globalThis as typeof globalThis & {
  __cairnTestFileSystem?: TestFsState;
};

const state = globalState.__cairnTestFileSystem ?? {
  files: new Map<string, string>(),
  directories: new Set<string>(['cairn-test-document://']),
};
globalState.__cairnTestFileSystem = state;

export const documentDirectory = 'cairn-test-document://';

export async function getInfoAsync(path: string) {
  return { exists: state.files.has(path) || state.directories.has(path) };
}

export async function makeDirectoryAsync(path: string) {
  state.directories.add(path.endsWith('/') ? path : `${path}/`);
}

export async function writeAsStringAsync(path: string, value: string) {
  state.files.set(path, value);
}

export async function readAsStringAsync(path: string) {
  const value = state.files.get(path);
  if (value === undefined) throw new Error('test_file_missing');
  return value;
}

export async function readDirectoryAsync(path: string) {
  const prefix = path.endsWith('/') ? path : `${path}/`;
  return [...state.files.keys()]
    .filter(key => key.startsWith(prefix) && !key.slice(prefix.length).includes('/'))
    .map(key => key.slice(prefix.length));
}

export async function deleteAsync(path: string) {
  if (path.endsWith('/')) {
    for (const key of [...state.files.keys()]) {
      if (key.startsWith(path)) state.files.delete(key);
    }
    for (const key of [...state.directories]) {
      if (key.startsWith(path)) state.directories.delete(key);
    }
    return;
  }
  state.files.delete(path);
}

export async function moveAsync({ from, to }: { from: string; to: string }) {
  const value = state.files.get(from);
  if (value === undefined) throw new Error('test_file_missing');
  state.files.set(to, value);
  state.files.delete(from);
}

export default {
  documentDirectory,
  getInfoAsync,
  makeDirectoryAsync,
  writeAsStringAsync,
  readAsStringAsync,
  readDirectoryAsync,
  deleteAsync,
  moveAsync,
};
