/** Shared mapping: GCP Secret Manager ID → local path (repo root relative). */
module.exports = {
  projectDefault: 'whatorder-fire',
  targets: [
    { secret: 'dev-root-env', dest: '.env' },
    { secret: 'dev-backend-env-local', dest: 'backend/.env.local' },
  ],
};
