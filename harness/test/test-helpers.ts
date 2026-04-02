import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

export async function withTempDir<T>(run: (rootDir: string) => Promise<T>, prefix = 'mersey-'): Promise<T> {
  const rootDir = await mkdtemp(join(tmpdir(), prefix));
  let runError: unknown;

  try {
    return await run(rootDir);
  } catch (error: unknown) {
    runError = error;
    throw error;
  } finally {
    try {
      await rm(rootDir, { force: true, recursive: true });
    } catch (cleanupError: unknown) {
      if (!runError) {
        throw cleanupError;
      }

      if (runError instanceof Error && cleanupError instanceof Error && runError.cause === undefined) {
        runError.cause = cleanupError;
      }
    }
  }
}

export async function writeWorkspaceFiles(rootDir: string, files: Record<string, string>): Promise<void> {
  await Promise.all(
    Object.entries(files).map(async ([relativePath, content]) => {
      const filePath = join(rootDir, relativePath);

      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, content, 'utf8');
    }),
  );
}
