# VaultZK Deployment Guide

## Hosting Platform
VaultZK uses Next.js and can be deployed as a Node.js web service.

## Render Configuration

- Runtime: Node.js
- Branch: main
- Build Command: npm install && npm run build
- Start Command: npm start
- Health Check: /api/health

## Environment Configuration

The application can build without DATABASE_URL when no database
is configured.

Do not commit environment files containing secrets.

## Local Development

Install dependencies:

npm install

Start development server:

npm run dev

Create production build:

npm run build

Start production server:

npm start

## Important Notes

- Keep sensitive credentials out of Git.
- Test changes locally before deployment.
- Verify production API endpoints after deployment.
