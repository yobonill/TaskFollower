import type { Task } from "../models/task";

const STOP_WORDS = new Set([
  "a",
  "al",
  "de",
  "del",
  "el",
  "en",
  "la",
  "las",
  "los",
  "para",
  "por",
  "un",
  "una",
  "y",
]);

const normalize = (value: string): string =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const tokenize = (value: string): string[] =>
  normalize(value)
    .split(" ")
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));

const levenshteinDistance = (left: string, right: string): number => {
  if (left === right) return 0;
  if (!left.length) return right.length;
  if (!right.length) return left.length;

  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  const current = new Array<number>(right.length + 1);

  for (let i = 1; i <= left.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const substitutionCost = left[i - 1] === right[j - 1] ? 0 : 1;
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + substitutionCost,
      );
    }
    for (let j = 0; j <= right.length; j += 1) previous[j] = current[j];
  }

  return previous[right.length];
};

const similarityScore = (left: string, right: string): number => {
  const normalizedLeft = normalize(left);
  const normalizedRight = normalize(right);
  if (!normalizedLeft || !normalizedRight) return 0;
  if (normalizedLeft === normalizedRight) return 1;

  if (
    normalizedLeft.length >= 7 &&
    normalizedRight.length >= 7 &&
    (normalizedLeft.includes(normalizedRight) || normalizedRight.includes(normalizedLeft))
  ) {
    return 0.94;
  }

  const leftTokens = new Set(tokenize(left));
  const rightTokens = new Set(tokenize(right));
  const union = new Set([...leftTokens, ...rightTokens]);
  let shared = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) shared += 1;
  }
  const tokenScore = union.size ? shared / union.size : 0;

  const maxLength = Math.max(normalizedLeft.length, normalizedRight.length);
  const editScore = maxLength
    ? 1 - levenshteinDistance(normalizedLeft, normalizedRight) / maxLength
    : 0;

  return Math.max(tokenScore, editScore * 0.92);
};

export const findSimilarOpenTasks = (
  candidate: Pick<Task, "id" | "name">,
  tasks: Task[],
): Task[] =>
  tasks
    .filter(
      (task) =>
        task.id !== candidate.id &&
        task.status === "pending" &&
        Boolean(task.name.trim()),
    )
    .map((task) => ({ task, score: similarityScore(candidate.name, task.name) }))
    .filter(({ score }) => score >= 0.58)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .map(({ task }) => task);
