FROM node:20-slim

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --no-audit --no-fund

COPY . .

EXPOSE 4000

# Runs directly via tsx rather than a separate tsc build step - see
# README "Why tsx instead of a compiled build" for the reasoning
# (drizzle-kit's loader constraints made this the simpler, still fully
# type-checked-in-CI choice for a project this size).
# The actual process (API vs worker) is selected by docker-compose's
# `command:` override for each service.
CMD ["npx", "tsx", "src/index.ts"]
