#!/bin/bash

# Color output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}=== Location Dataflow Deployment Script ===${NC}"

# Check prerequisites
check_prerequisites() {
    echo -e "${YELLOW}Checking prerequisites...${NC}"

    if ! command -v gcloud &> /dev/null; then
        echo -e "${RED}Error: gcloud CLI not found. Install it first.${NC}"
        exit 1
    fi

    if ! command -v terraform &> /dev/null; then
        echo -e "${RED}Error: Terraform not found. Install it first.${NC}"
        exit 1
    fi

    echo -e "${GREEN}✓ All prerequisites met${NC}"
}

# Deploy everything via Terraform
deploy() {
    echo -e "${YELLOW}Deploying all infrastructure via Terraform...${NC}"

    cd terraform

    terraform init

    if ! terraform validate; then
        echo -e "${RED}Terraform validation failed${NC}"
        exit 1
    fi

    terraform plan -out=tfplan

    echo -e "${YELLOW}Ready to apply Terraform plan. Continue? (yes/no)${NC}"
    read -r CONFIRM

    if [ "$CONFIRM" = "yes" ]; then
        terraform apply tfplan
        echo -e "${GREEN}✓ All infrastructure deployed${NC}"
        terraform output > terraform-outputs.txt
        echo -e "${GREEN}Outputs saved to terraform-outputs.txt${NC}"
    else
        echo -e "${YELLOW}Deployment cancelled${NC}"
        rm tfplan
        exit 0
    fi

    cd ..
}

# Main flow
main() {
    check_prerequisites
    deploy

    echo -e "${GREEN}"
    echo "=== Deployment Complete ==="
    echo ""
    echo "Everything is deployed via Terraform:"
    echo "  ✓ Pub/Sub topics & subscriptions"
    echo "  ✓ Firestore database"
    echo "  ✓ Cloud SQL instance"
    echo "  ✓ Dataflow pipeline (staging files + job)"
    echo "  ✓ Cloud Run API service"
    echo "  ✓ Artifact Registry"
    echo ""
    echo "Check Cloud Run URL:"
    echo "  terraform -chdir=terraform output cloud_run_url"
    echo -e "${NC}"
}

main
