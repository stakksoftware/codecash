// Surface detection for `codecash wrap` (Phase 3). Maps a wrapped command to a
// coarse surface category and locally-derived context tags. Like all CodeCash
// targeting, this runs on-device and only the coarse surface category (e.g.
// "build-ci") is ever sent — never the command, its args, or paths (FR17).

const RULES = [
  // [regex on argv[0..], surface, tags]
  [/^(npm|pnpm|yarn|bun)\b.*\b(install|ci|i)\b/, 'build-ci', ['javascript']],
  [/^(npm|pnpm|yarn|bun)\b.*\b(run\s+)?(build|test|watch)/, 'build-ci', ['javascript']],
  [/^cargo\b.*\b(build|test|check|run)/, 'build-ci', ['rust']],
  [/^go\b.*\b(build|test|mod)/, 'build-ci', ['go']],
  [/^(pip|pip3|poetry|uv)\b.*\b(install|sync)/, 'build-ci', ['python']],
  [/^(pytest|tox)\b/, 'build-ci', ['python']],
  [/^docker\b.*\bbuild/, 'build-ci', ['docker']],
  [/^docker-compose\b|^docker\s+compose\b/, 'build-ci', ['docker']],
  [/^make\b/, 'build-ci', []],
  [/^gradle\b|^\.\/gradlew\b|^mvn\b/, 'build-ci', ['java']],
  [/^terraform\b.*\b(plan|apply)/, 'long-job', ['terraform']],
  [/^(kubectl|helm)\b/, 'long-job', ['kubernetes']],
  [/^(dbt)\b/, 'long-job', ['data']],
  [/^(airflow)\b/, 'long-job', ['data']],
  [/\b(train|fit|finetune|fine-tune)\b/, 'long-job', ['ml']],
  [/^(python|python3)\b.*\b(train|run)/, 'long-job', ['python', 'ml']],
];

/**
 * @param {string[]} argv  the wrapped command + args
 * @returns {{ surface: string, tags: string[], commandName: string }}
 */
export function detectSurface(argv) {
  const cmdline = (argv || []).join(' ');
  const commandName = (argv && argv[0]) || '';
  for (const [re, surface, tags] of RULES) {
    if (re.test(cmdline)) return { surface, tags, commandName };
  }
  // Unknown long-running command → generic job surface.
  return { surface: 'long-job', tags: [], commandName };
}
