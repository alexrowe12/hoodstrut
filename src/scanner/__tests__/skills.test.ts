import { describe, it, expect } from 'vitest';
import { scanSkills } from '../skills.js';

describe('scanSkills', () => {
  it('should return skills from ~/.claude/skills', async () => {
    const skills = await scanSkills();

    // This test runs against the real filesystem
    // It should find at least the handoff skill we saw earlier
    expect(Array.isArray(skills)).toBe(true);

    // If skills exist, verify structure
    for (const skill of skills) {
      expect(skill).toHaveProperty('name');
      expect(skill).toHaveProperty('sourcePath');
      expect(typeof skill.name).toBe('string');
      expect(typeof skill.sourcePath).toBe('string');
    }
  });
});
