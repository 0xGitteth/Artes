export const cleanupCodexDevPostTrees = async ({ db, postDocs = [], dryRun = true } = {}) => {
  const failed = [];
  let deleted = 0;
  if (dryRun) return { deleted, failed };
  for (const post of postDocs) {
    try {
      await db.recursiveDelete(post.ref);
      deleted += 1;
    } catch (error) {
      failed.push({ path: post.ref.path, error: error?.message || String(error) });
    }
  }
  return { deleted, failed };
};
