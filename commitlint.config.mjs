// Commit messages (CLAUDE.md): subject <= 72 chars, body <= 3 lines. Trailers (`Co-Authored-By:` and the like) do not count as body lines.
const TRAILER = /^[A-Za-z-]+: /u;

const NO_COMMIT = { body: '' };
/** The body has at most `max` lines, trailers and blank lines excluded. Defaults give the parameters their types. */
const bodyMaxLines = (commit = NO_COMMIT, _when = 'always', max = 3) => {
  const lines = (commit.body ?? '').split('\n').filter((l) => l.trim() !== '' && !TRAILER.test(l));
  return [lines.length <= max, `body has ${String(lines.length)} lines; keep it to ${String(max)}`];
};

export default {
  rules: {
    'header-max-length': [2, 'always', 72],
    'header-trim': [2, 'always'],
    'header-full-stop': [2, 'never', '.'],
    'body-leading-blank': [2, 'always'],
    'body-max-lines': [2, 'always', 3],
  },
  plugins: [{ rules: { 'body-max-lines': bodyMaxLines } }],
};
