import { createWriteStream, WriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import type { Readable } from 'node:stream';

export interface CaptureStreams {
  stdoutPath: string;
  stderrPath: string;
  stdoutStream: WriteStream;
  stderrStream: WriteStream;
}

export async function createCaptureStreams(
  outputDir: string,
  _verbose: boolean = false
): Promise<CaptureStreams> {
  await mkdir(outputDir, { recursive: true });

  const stdoutPath = `${outputDir}/stdout.log`;
  const stderrPath = `${outputDir}/stderr.log`;

  const stdoutStream = createWriteStream(stdoutPath);
  const stderrStream = createWriteStream(stderrPath);

  return {
    stdoutPath,
    stderrPath,
    stdoutStream,
    stderrStream,
  };
}

export function pipeWithLogging(
  source: Readable | null,
  dest: WriteStream,
  verbose: boolean,
  prefix: string
): void {
  if (!source) return;

  source.on('data', (chunk: Buffer) => {
    dest.write(chunk);
    if (verbose) {
      const lines = chunk.toString().split('\n');
      for (const line of lines) {
        if (line.trim()) {
          console.log(`${prefix} ${line}`);
        }
      }
    }
  });
}

export function closeCaptureStreams(streams: CaptureStreams): Promise<void> {
  return new Promise((resolve) => {
    let closed = 0;
    const checkDone = () => {
      closed++;
      if (closed >= 2) resolve();
    };

    streams.stdoutStream.end(checkDone);
    streams.stderrStream.end(checkDone);
  });
}
