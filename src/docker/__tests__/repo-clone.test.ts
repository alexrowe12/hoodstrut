import { beforeEach, describe, expect, it, vi } from 'vitest';

const { execaMock } = vi.hoisted(() => ({
  execaMock: vi.fn(),
}));

vi.mock('execa', () => ({
  execa: execaMock,
}));

import { cloneRepo } from '../repo-preparer.js';

describe('cloneRepo', () => {
  beforeEach(() => {
    execaMock.mockReset();
    execaMock.mockResolvedValue({ stdout: '', stderr: '' });
  });

  it('invokes Git with an argument array and no shell', async () => {
    await cloneRepo('https://example.com/org/repo.git', 'main', '/tmp/workspace');

    expect(execaMock).toHaveBeenCalledWith(
      'git',
      [
        'clone',
        '--depth',
        '1',
        '--branch',
        'main',
        '--',
        'https://example.com/org/repo.git',
        '/tmp/workspace',
      ],
      { timeout: 120000 }
    );
    expect(execaMock.mock.calls[0][2]).not.toHaveProperty('shell');
  });

  it('keeps shell metacharacters inside individual arguments', async () => {
    const branch = 'main; touch /tmp/branch-pwned';
    const url = 'https://example.com/repo.git; touch /tmp/url-pwned';

    await cloneRepo(url, branch, '/tmp/workspace');

    const args = execaMock.mock.calls[0][1] as string[];
    expect(args).toContain(branch);
    expect(args).toContain(url);
    expect(args[args.indexOf('--branch') + 1]).toBe(branch);
    expect(args[args.indexOf('--') + 1]).toBe(url);
  });

  it('uses Git stderr in a readable clone failure', async () => {
    execaMock.mockRejectedValue({
      message: 'Command failed',
      stderr: 'fatal: repository not found',
    });

    await expect(
      cloneRepo('https://example.com/missing.git', 'main', '/tmp/workspace')
    ).rejects.toThrow('Failed to clone repository: fatal: repository not found');
  });
});
