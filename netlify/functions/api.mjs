import { getStore } from '@netlify/blobs';
import { createAPI } from '../../lib/api.mjs';
import quizzes from '../../data/quizzes.json' with { type: 'json' };

export default async function handler(request) {
  const store = getStore({ name: 'goldfryd-quizzes', consistency: 'strong' });
  return createAPI({ store, seedQuizzes: quizzes, adminPin: process.env.ADMIN_PIN })(request);
}
