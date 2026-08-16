# MAMS Storage Audit - Makefile
# Usage: make <command>

# Variables
APP_NAME = mams-storage-audit
DOCKER_IMAGE = mams-storage-audit
DOCKER_CONTAINER = mams-storage-audit
DATA_DIR = ./data
BACKUP_DIR = ./backups
PORT = 5179

# Colors for output
GREEN = \033[0;32m
RED = \033[0;31m
YELLOW = \033[1;33m
NC = \033[0m

.PHONY: help build up down restart rebuild logs status shell backup restore list-backups clean prune test-api dev prod force-rebuild cp-server cp-app restart-container full-rebuild quick-update

help:
	@echo "MAMS Storage Audit - Available Commands:"
	@echo ""
	@echo "  \033[0;32mmake build\033[0m           - Build Docker image"
	@echo "  \033[0;32mmake up\033[0m              - Start container"
	@echo "  \033[0;32mmake down\033[0m            - Stop container"
	@echo "  \033[0;32mmake restart\033[0m         - Restart container"
	@echo "  \033[0;32mmake rebuild\033[0m         - Rebuild and restart (Docker only)"
	@echo "  \033[0;32mmake full-rebuild\033[0m    - Complete rebuild (npm + Docker)"
	@echo "  \033[0;32mmake quick-update\033[0m    - Quick update (npm build + copy + restart)"
	@echo "  \033[0;32mmake logs\033[0m            - View container logs"
	@echo "  \033[0;32mmake status\033[0m          - Check container status"
	@echo "  \033[0;32mmake shell\033[0m           - Open shell in container"
	@echo ""
	@echo "  \033[1;33mFile Copy (Quick Updates without npm build):\033[0m"
	@echo "  \033[0;32mmake cp-server\033[0m       - Copy server.js to running container"
	@echo "  \033[0;32mmake cp-app\033[0m          - Copy App.tsx to running container"
	@echo "  \033[0;32mmake restart-container\033[0m - Restart container after file copy"
	@echo "  \033[0;32mmake update-server\033[0m   - Copy server.js and restart"
	@echo ""
	@echo "  \033[1;33mBackup & Restore:\033[0m"
	@echo "  \033[0;32mmake backup\033[0m          - Backup all data"
	@echo "  \033[0;32mmake restore\033[0m         - Restore from latest backup"
	@echo "  \033[0;32mmake list-backups\033[0m    - List all backups"
	@echo ""
	@echo "  \033[1;33mUtilities:\033[0m"
	@echo "  \033[0;32mmake clean\033[0m           - Remove container and image"
	@echo "  \033[0;32mmake prune\033[0m           - Clean up Docker resources"
	@echo "  \033[0;32mmake test-api\033[0m        - Test API endpoints"
	@echo "  \033[0;32mmake force-rebuild\033[0m   - Force rebuild with clean cache"

# Docker Management
build:
	@echo "\033[0;32mBuilding Docker image...\033[0m"
	docker build -t $(DOCKER_IMAGE) .
	@echo "\033[0;32mBuild complete!\033[0m"

up:
	@echo "\033[0;32mStarting container...\033[0m"
	docker run -d \
		--name $(DOCKER_CONTAINER) \
		--restart unless-stopped \
		-p $(PORT):$(PORT) \
		-v $(PWD)/data:/var/www/mams-storage-audit/data \
		-v $(PWD)/mams-automation/reports:/var/www/mams-storage-audit/mams-automation/reports \
		$(DOCKER_IMAGE)
	@echo "\033[0;32mContainer started on port $(PORT)\033[0m"

down:
	@echo "\033[1;33mStopping container...\033[0m"
	-docker stop $(DOCKER_CONTAINER) 2>/dev/null
	-docker rm $(DOCKER_CONTAINER) 2>/dev/null
	@echo "\033[0;32mContainer stopped and removed\033[0m"

restart: down up
	@echo "\033[0;32mContainer restarted\033[0m"

rebuild: down
	@echo "\033[1;33mRemoving old image...\033[0m"
	-docker rmi $(DOCKER_IMAGE) 2>/dev/null
	@echo "\033[0;32mBuilding new image...\033[0m"
	docker build -t $(DOCKER_IMAGE) .
	@echo "\033[0;32mStarting container...\033[0m"
	docker run -d \
		--name $(DOCKER_CONTAINER) \
		--restart unless-stopped \
		-p $(PORT):$(PORT) \
		-v $(PWD)/data:/var/www/mams-storage-audit/data \
		-v $(PWD)/mams-automation/reports:/var/www/mams-storage-audit/mams-automation/reports \
		$(DOCKER_IMAGE)
	@echo "\033[0;32mRebuild complete!\033[0m"

# Complete rebuild (npm + Docker)
full-rebuild:
	@echo "\033[1;33m=== COMPLETE REBUILD ===\033[0m"
	@echo "\033[0;32m1. Cleaning old files...\033[0m"
	rm -rf node_modules dist
	@echo "\033[0;32m2. Installing dependencies...\033[0m"
	npm install
	@echo "\033[0;32m3. Building React app...\033[0m"
	npm run build
	@echo "\033[0;32m4. Stopping container...\033[0m"
	docker stop $(DOCKER_CONTAINER) 2>/dev/null || true
	docker rm $(DOCKER_CONTAINER) 2>/dev/null || true
	@echo "\033[0;32m5. Building Docker image...\033[0m"
	docker build --no-cache -t $(DOCKER_IMAGE) .
	@echo "\033[0;32m6. Starting container...\033[0m"
	docker run -d \
		--name $(DOCKER_CONTAINER) \
		--restart unless-stopped \
		-p $(PORT):$(PORT) \
		-v $(PWD)/data:/var/www/mams-storage-audit/data \
		-v $(PWD)/mams-automation/reports:/var/www/mams-storage-audit/mams-automation/reports \
		$(DOCKER_IMAGE)
	@echo "\033[0;32m✅ Complete rebuild finished!\033[0m"
	@echo "App running at http://localhost:$(PORT)"

# Quick update (npm build + copy to existing container)
quick-update:
	@echo "\033[1;33m=== QUICK UPDATE ===\033[0m"
	@echo "\033[0;32m1. Building React app...\033[0m"
	npm run build
	@echo "\033[0;32m2. Copying dist to container...\033[0m"
	docker cp dist $(DOCKER_CONTAINER):/var/www/mams-storage-audit/dist
	@echo "\033[0;32m3. Restarting container...\033[0m"
	docker restart $(DOCKER_CONTAINER)
	@echo "\033[0;32m✅ Quick update complete!\033[0m"

# File Copy Commands (Quick Updates without full rebuild)
cp-server:
	@echo "\033[0;32mCopying server.js to container...\033[0m"
	-docker cp server.js $(DOCKER_CONTAINER):/var/www/mams-storage-audit/server.js
	@echo "\033[0;32mserver.js copied successfully!\033[0m"

cp-app:
	@echo "\033[0;32mCopying App.tsx to container...\033[0m"
	-docker cp src/App.tsx $(DOCKER_CONTAINER):/var/www/mams-storage-audit/src/App.tsx
	@echo "\033[0;32mApp.tsx copied successfully!\033[0m"

restart-container:
	@echo "\033[1;33mRestarting container...\033[0m"
	docker restart $(DOCKER_CONTAINER)
	@echo "\033[0;32mContainer restarted!\033[0m"

# One-command updates (copy + restart)
update-server: cp-server restart-container
	@echo "\033[0;32mServer updated and container restarted!\033[0m"
	@echo "\033[1;33mNote: For changes to take effect, you may need to rebuild the React app with 'make quick-update'\033[0m"

update-app: cp-app restart-container
	@echo "\033[0;32mApp source copied! Run 'make quick-update' to rebuild and apply changes\033[0m"

# Logs and Status
logs:
	docker logs -f $(DOCKER_CONTAINER)

status:
	@echo "\033[0;32mContainer status:\033[0m"
	docker ps -a --filter name=$(DOCKER_CONTAINER)
	@echo ""
	@echo "\033[0;32mContainer ports:\033[0m"
	docker port $(DOCKER_CONTAINER) 2>/dev/null || echo "Container not running"

shell:
	docker exec -it $(DOCKER_CONTAINER) sh

# Backup and Restore (FIXED)
backup:
	@echo "\033[0;32mCreating backup...\033[0m"
	@mkdir -p $(BACKUP_DIR)
	@BACKUP_FILE=$(BACKUP_DIR)/mams_backup_$$(date +%Y%m%d_%H%M%S).tar.gz; \
	tar -czf $$BACKUP_FILE -C $(DATA_DIR) .; \
	echo "\033[0;32mBackup created: $$BACKUP_FILE\033[0m"
	@ls -lh $(BACKUP_DIR)/*.tar.gz | tail -1
	@echo "\033[0;32mBackup complete!\033[0m"

restore:
	@echo "\033[1;33mAvailable backups:\033[0m"
	@ls -lh $(BACKUP_DIR)/*.tar.gz 2>/dev/null || echo "No backups found"
	@echo ""
	@read -p "Enter backup filename to restore (or 'latest' for most recent): " BACKUP_FILE; \
	if [ "$$BACKUP_FILE" = "latest" ]; then \
		BACKUP_FILE=$$(ls -t $(BACKUP_DIR)/*.tar.gz 2>/dev/null | head -1); \
		echo "Using latest: $$BACKUP_FILE"; \
	fi; \
	if [ -z "$$BACKUP_FILE" ] || [ ! -f "$$BACKUP_FILE" ]; then \
		echo "\033[0;31mBackup file not found!\033[0m"; \
		exit 1; \
	fi; \
	echo "\033[1;33mRestoring from $$BACKUP_FILE...\033[0m"; \
	echo "\033[0;32mStopping container...\033[0m"; \
	docker stop $(DOCKER_CONTAINER) 2>/dev/null || true; \
	echo "\033[0;32mRestoring data files...\033[0m"; \
	rm -rf $(DATA_DIR)/*; \
	tar -xzf $$BACKUP_FILE -C $(DATA_DIR); \
	echo "\033[0;32mStarting container...\033[0m"; \
	docker start $(DOCKER_CONTAINER) 2>/dev/null || echo "Container not running, start with 'make up'"; \
	echo "\033[0;32mRestore complete! Data restored from: $$(basename $$BACKUP_FILE)\033[0m"

list-backups:
	@echo "\033[0;32mAvailable backups:\033[0m"
	@ls -lh $(BACKUP_DIR)/*.tar.gz 2>/dev/null || echo "No backups found"

# Utilities
clean: down
	@echo "\033[1;33mRemoving container and image...\033[0m"
	-docker rm $(DOCKER_CONTAINER) 2>/dev/null
	-docker rmi $(DOCKER_IMAGE) 2>/dev/null
	@echo "\033[0;32mClean complete!\033[0m"

prune:
	@echo "\033[1;33mCleaning up Docker resources...\033[0m"
	docker system prune -f
	@echo "\033[0;32mPrune complete!\033[0m"

test-api:
	@echo "\033[0;32mTesting API endpoints...\033[0m"
	@echo ""
	@echo "Health check:"
	curl -s http://localhost:$(PORT)/api/health | jq . 2>/dev/null || curl -s http://localhost:$(PORT)/api/health
	@echo ""
	@echo "Usage data:"
	curl -s http://localhost:$(PORT)/api/usage | jq . 2>/dev/null || curl -s http://localhost:$(PORT)/api/usage
	@echo ""
	@echo "Users:"
	curl -s http://localhost:$(PORT)/api/users | jq . 2>/dev/null || curl -s http://localhost:$(PORT)/api/users
	@echo ""

# Quick commands
dev: down rebuild up logs

prod: full-rebuild
	@echo "\033[0;32mProduction deployment complete!\033[0m"
	@echo "Access at: http://localhost:$(PORT)"

# Emergency fix - force rebuild with clean cache
force-rebuild:
	@echo "\033[0;31mForce rebuilding with clean cache...\033[0m"
	docker compose down 2>/dev/null || true
	docker rm -f $(DOCKER_CONTAINER) 2>/dev/null || true
	docker rmi $(DOCKER_IMAGE) 2>/dev/null || true
	docker system prune -f
	rm -rf node_modules dist
	npm install
	npm run build
	docker build --no-cache -t $(DOCKER_IMAGE) .
	docker run -d \
		--name $(DOCKER_CONTAINER) \
		--restart unless-stopped \
		-p $(PORT):$(PORT) \
		-v $(PWD)/data:/var/www/mams-storage-audit/data \
		-v $(PWD)/mams-automation/reports:/var/www/mams-storage-audit/mams-automation/reports \
		$(DOCKER_IMAGE)
	@echo "\033[0;32mForce rebuild complete!\033[0m"
