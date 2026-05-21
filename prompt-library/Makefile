# Makefile for AgentOS Prompt Library
# AI prompt curation platform — Docker Compose deployment

.PHONY: help setup init build build-no-cache clean lint test \
        compose-deploy compose-up compose-down compose-status \
        compose-logs compose-logs-app compose-restart \
        compose-clean compose-clean-all compose-seed compose-sync-admins \
        compose-shell compose-test \
        compose-validate compose-compile compose-install compose-verify compose-clean-lifecycle \
        sync-with-master c c-logs c-clean c-status

# Color output
BLUE := \033[0;34m
GREEN := \033[0;32m
YELLOW := \033[1;33m
RED := \033[0;31m
NC := \033[0m
DIM := \033[2m

# Configuration
VERSION ?= 0.1.0
IMAGE_NAME := agentos-prompt-library
APP_PORT  := 4444

# Default target
help:
	@echo ""
	@echo "$(BLUE)╔════════════════════════════════════════════════════════════════╗$(NC)"
	@echo "$(BLUE)║$(NC)  AgentOS Prompt Library - Build & Deploy                       $(BLUE)║$(NC)"
	@echo "$(BLUE)╚════════════════════════════════════════════════════════════════╝$(NC)"
	@echo ""
	@echo "$(BLUE)Common Targets:$(NC)"
	@echo "  $(GREEN)setup$(NC)        - First-time environment setup (check tools, create .env, pull image)"
	@echo "  $(GREEN)init$(NC)         - Start Docker runtime (Colima)"
	@echo "  $(GREEN)build$(NC)        - Build Docker image"
	@echo "  $(GREEN)test$(NC)         - Test deployment health"
	@echo "  $(GREEN)lint$(NC)         - Run linters (YAML, Dockerfile, Makefile syntax)"
	@echo "  $(GREEN)clean$(NC)        - Clean build artifacts"
	@echo ""
	@echo "$(BLUE)Maven-Style Lifecycle (auto-chain dependencies):$(NC)"
	@echo "  $(GREEN)compose-validate$(NC)       → validate .env and compose.yml"
	@echo "  $(GREEN)compose-compile$(NC)        → compose-validate → build image"
	@echo "  $(GREEN)compose-install$(NC)        → compose-compile → start services"
	@echo "  $(GREEN)compose-verify$(NC)         → compose-install → verify deployment"
	@echo "  $(GREEN)compose-clean-lifecycle$(NC) → clean all artifacts"
	@echo ""
	@echo "$(BLUE)Compose Targets:$(NC)"
	@echo "  $(GREEN)compose-deploy$(NC)         - Deploy full stack"
	@echo "  $(GREEN)compose-up$(NC)             - Start services"
	@echo "  $(GREEN)compose-down$(NC)           - Stop services"
	@echo "  $(GREEN)compose-status$(NC)         - Check service status"
	@echo "  $(GREEN)compose-logs$(NC)           - Tail all logs"
	@echo "  $(GREEN)compose-logs-app$(NC)       - Tail app logs"
	@echo "  $(GREEN)compose-restart$(NC)        - Restart services"
	@echo "  $(GREEN)compose-seed$(NC)           - Seed database"
	@echo "  $(GREEN)compose-sync-admins$(NC)    - Sync admin roles"
	@echo "  $(GREEN)compose-shell$(NC)          - Open shell in app container"
	@echo "  $(GREEN)compose-test$(NC)           - Health check"
	@echo "  $(GREEN)compose-clean$(NC)          - Stop + remove volumes"
	@echo "  $(GREEN)compose-clean-all$(NC)      - Full cleanup (services + volumes + network)"
	@echo ""
	@echo "$(BLUE)Short Aliases:$(NC)  c, c-logs, c-clean, c-status"
	@echo ""
	@echo "$(BLUE)Quick Start:$(NC)"
	@echo "  $(DIM)make setup              # First-time setup$(NC)"
	@echo "  $(DIM)make init               # Start Docker$(NC)"
	@echo "  $(DIM)make compose-install    # Build + deploy$(NC)"
	@echo "  $(DIM)make test               # Verify$(NC)"
	@echo ""

# ==============================================================================
# Common Targets
# ==============================================================================

init:
	@echo "$(BLUE)▸ Initializing Docker runtime...$(NC)"
	@if ! command -v colima >/dev/null 2>&1; then \
		echo "$(YELLOW)⚠ Colima not installed. Install with: brew install colima$(NC)"; \
		echo "$(YELLOW)  (Or ensure Docker Desktop is running)$(NC)"; \
	else \
		list_out=$$(colima list 2>/dev/null | awk 'NR>1 && /default/{print}'); \
		if ! echo "$$list_out" | grep -qi "running"; then \
			echo "$(BLUE)  → Starting Colima (4 CPU, 8GB RAM, 60GB disk)...$(NC)"; \
			colima start --cpu 4 --memory 8 --disk 60; \
		else \
			echo "$(GREEN)✓ Colima running$(NC)"; \
		fi; \
		docker context ls 2>/dev/null | grep -q "^colima\b" && docker context use colima >/dev/null 2>&1 || true; \
	fi
	@if docker info >/dev/null 2>&1; then \
		echo "$(GREEN)✓ Docker is accessible$(NC)"; \
	else \
		echo "$(RED)✗ Docker not accessible. Start Colima or Docker Desktop.$(NC)"; \
		exit 1; \
	fi

clean:
	@echo "$(BLUE)▸ Cleaning build artifacts...$(NC)"
	@rm -f *.tgz
	@echo "$(GREEN)✓ Cleanup complete$(NC)"

setup:
	@echo "$(BLUE)╔════════════════════════════════════════════════════════════════╗$(NC)"
	@echo "$(BLUE)║$(NC)  AgentOS Prompt Library - Environment Setup                    $(BLUE)║$(NC)"
	@echo "$(BLUE)╚════════════════════════════════════════════════════════════════╝$(NC)"
	@echo ""
	@echo "$(BLUE)▸ Checking prerequisites...$(NC)"
	@command -v docker >/dev/null 2>&1 || { echo "$(RED)  ✗ Docker not found. Install: brew install --cask docker$(NC)"; exit 1; }
	@echo "$(GREEN)  ✓ Docker found$(NC)"
	@command -v docker compose >/dev/null 2>&1 || { echo "$(RED)  ✗ Docker Compose not found. Install: brew install docker-compose$(NC)"; exit 1; }
	@echo "$(GREEN)  ✓ Docker Compose found$(NC)"
	@command -v make >/dev/null 2>&1 && echo "$(GREEN)  ✓ make found$(NC)" || { echo "$(RED)  ✗ make not found. Install: xcode-select --install$(NC)"; exit 1; }
	@echo ""
	@echo "$(BLUE)▸ Environment configuration...$(NC)"
	@if [ ! -f .env ]; then \
		if [ -f .env.example ]; then \
			echo "$(YELLOW)  → Creating .env from .env.example...$(NC)"; \
			cp .env.example .env; \
			echo "$(GREEN)  ✓ .env file created$(NC)"; \
		else \
			echo "$(YELLOW)  ⚠ No .env or .env.example found — create .env manually$(NC)"; \
		fi; \
		echo ""; \
		echo "$(YELLOW)  ⚠ Update .env with your configuration:$(NC)"; \
		echo "$(DIM)    - DATABASE_URL (PostgreSQL connection)$(NC)"; \
		echo "$(DIM)    - AUTH_SECRET (generate with: openssl rand -base64 32)$(NC)"; \
		echo "$(DIM)    - GitHub OAuth (AUTH_GITHUB_ID, AUTH_GITHUB_SECRET)$(NC)"; \
	else \
		echo "$(GREEN)  ✓ .env file exists$(NC)"; \
	fi
	@echo "$(BLUE)▸ Pulling base image...$(NC)"
	@docker pull ghcr.io/f/prompts.chat:latest >/dev/null 2>&1 && \
		echo "$(GREEN)  ✓ Base image pulled$(NC)" || \
		echo "$(YELLOW)  ⚠ Failed to pull base image (will pull during build)$(NC)"
	@echo ""
	@echo "$(GREEN)✓ Setup complete!$(NC)"
	@echo ""
	@echo "$(BLUE)Next steps:$(NC)"
	@echo "  1. $(DIM)Edit .env: vi .env$(NC)"
	@echo "  2. $(DIM)Start Docker: make init$(NC)"
	@echo "  3. $(DIM)Deploy: make compose-install$(NC)"
	@echo ""

build:
	@echo "$(BLUE)▸ Building Docker image (version: $(VERSION))...$(NC)"
	@docker build \
		--build-arg app=$(IMAGE_NAME) \
		--build-arg version=$(VERSION) \
		--build-arg lastCommitHash=$(shell git rev-parse --short HEAD 2>/dev/null || echo "dev") \
		--build-arg lastCommitAuthorEmail=$(shell git log -1 --format='%ae' 2>/dev/null || echo "unknown") \
		-t $(IMAGE_NAME):$(VERSION) \
		-t $(IMAGE_NAME):latest \
		.
	@echo "$(GREEN)✓ Image built: $(IMAGE_NAME):$(VERSION)$(NC)"

build-no-cache:
	@echo "$(BLUE)▸ Building Docker image without cache...$(NC)"
	@docker build --no-cache \
		--build-arg app=$(IMAGE_NAME) \
		--build-arg version=$(VERSION) \
		-t $(IMAGE_NAME):$(VERSION) \
		-t $(IMAGE_NAME):latest \
		.
	@echo "$(GREEN)✓ Image built (no cache)$(NC)"

test: compose-test

lint:
	@echo "$(BLUE)▸ Running linters...$(NC)"
	@docker compose -f compose.yml config > /dev/null 2>&1 && echo "$(GREEN)  ✓ compose.yml is valid$(NC)" || echo "$(RED)  ✗ compose.yml has errors$(NC)"
	@docker run --rm -i hadolint/hadolint < Dockerfile > /dev/null 2>&1 && echo "$(GREEN)  ✓ Dockerfile is valid$(NC)" || echo "$(YELLOW)  ⚠ Dockerfile linting warnings (non-blocking)$(NC)"
	@make -n help > /dev/null 2>&1 && echo "$(GREEN)  ✓ Makefile syntax is valid$(NC)" || echo "$(RED)  ✗ Makefile has syntax errors$(NC)"
	@echo "$(GREEN)✓ Linting complete$(NC)"

# ==============================================================================
# Compose Targets
# ==============================================================================

compose-deploy: setup build compose-up
	@echo "$(GREEN)✓ Compose deployment complete$(NC)"
	@echo "$(YELLOW)Access UI: http://localhost:$(APP_PORT)$(NC)"

compose-up:
	@echo "$(BLUE)▸ Starting services...$(NC)"
	@docker compose up -d
	@echo "$(GREEN)✓ Services started$(NC)"
	@echo "$(YELLOW)Access UI: http://localhost:$(APP_PORT)$(NC)"

compose-down:
	@echo "$(BLUE)▸ Stopping services...$(NC)"
	@docker compose down
	@echo "$(GREEN)✓ Services stopped$(NC)"

compose-status:
	@echo "$(BLUE)▸ Service Status:$(NC)"
	@docker compose ps

compose-logs:
	@docker compose logs -f

compose-logs-app:
	@docker compose logs -f $(IMAGE_NAME)

compose-restart:
	@echo "$(BLUE)▸ Restarting services...$(NC)"
	@docker compose restart
	@echo "$(GREEN)✓ Services restarted$(NC)"

compose-clean:
	@echo "$(BLUE)▸ Cleaning Docker environment...$(NC)"
	@docker compose down -v
	@echo "$(GREEN)✓ Services and volumes removed$(NC)"

compose-clean-all: compose-clean
	@docker network rm $(IMAGE_NAME)-network 2>/dev/null || true
	@echo "$(GREEN)✓ Full cleanup complete$(NC)"

compose-seed:
	@echo "$(BLUE)▸ Seeding database...$(NC)"
	@docker cp prisma/seed.ts $(IMAGE_NAME):/app/prisma/seed.ts
	@docker exec $(IMAGE_NAME) npx tsx prisma/seed.ts
	@echo "$(GREEN)✓ Database seeded$(NC)"
	@echo "$(YELLOW)  Seed admin: admin@agentos.dev$(NC)"

compose-sync-admins:
	@echo "$(BLUE)▸ Syncing admins from config/admins.json...$(NC)"
	@docker cp config/admins.json $(IMAGE_NAME):/app/config/admins.json
	@docker cp scripts/sync-admins.js $(IMAGE_NAME):/app/scripts/sync-admins.js
	@docker exec $(IMAGE_NAME) node scripts/sync-admins.js
	@echo "$(GREEN)✓ Admin sync complete$(NC)"

compose-shell:
	@docker exec -it $(IMAGE_NAME) sh

compose-test:
	@echo "$(BLUE)▸ Testing deployment...$(NC)"
	@docker compose ps | grep -q "$(IMAGE_NAME).*Up" || { echo "$(RED)✗ Services not running. Run 'make compose-install' first$(NC)"; exit 1; }
	@echo "$(GREEN)  ✓ Services are running$(NC)"
	@echo "  → Waiting for application..."
	@echo "$(DIM)    (First run may take 2-3 minutes)$(NC)"
	@for i in $$(seq 1 30); do \
		if curl -f -s -o /dev/null http://localhost:$(APP_PORT)/; then \
			echo "$(GREEN)  ✓ Application is responding$(NC)"; \
			break; \
		fi; \
		if [ $$i -eq 30 ]; then \
			echo "$(RED)✗ Application not responding after 90 seconds$(NC)"; \
			echo "$(YELLOW)  Check logs with: make compose-logs-app$(NC)"; \
			exit 1; \
		fi; \
		sleep 3; \
	done
	@echo "$(GREEN)✓ Deployment test passed$(NC)"
	@echo "$(DIM)  Access UI: http://localhost:$(APP_PORT)$(NC)"

# Compose Lifecycle (Maven-style)
compose-validate: setup
	@echo "$(BLUE)▸ Validating compose configuration...$(NC)"
	@docker compose config > /dev/null
	@echo "$(GREEN)✓ Validation passed$(NC)"

compose-compile: compose-validate build
	@echo "$(GREEN)✓ Compose compile phase complete$(NC)"

compose-install: compose-compile compose-up
	@echo "$(GREEN)✓ Compose install phase complete$(NC)"

compose-verify: compose-install
	@sleep 5
	@docker compose ps | grep -q "Up" && echo "$(GREEN)✓ Verification passed$(NC)" || { echo "$(RED)✗ Verification failed$(NC)"; exit 1; }

compose-clean-lifecycle: compose-clean-all clean
	@echo "$(GREEN)✓ Compose clean lifecycle complete$(NC)"

# ==============================================================================
# Short Aliases
# ==============================================================================
c: compose-deploy
c-logs: compose-logs
c-clean: compose-clean
c-status: compose-status
