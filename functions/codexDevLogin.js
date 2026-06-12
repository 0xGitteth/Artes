export const isProductionNodeEnv = (env = process.env) => String(env.NODE_ENV || '').trim().toLowerCase() === 'production';

export const canIssueCodexDevToken = (env = process.env) => !isProductionNodeEnv(env);
