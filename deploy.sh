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

    # Check gcloud
    if ! command -v gcloud &> /dev/null; then
        echo -e "${RED}Error: gcloud CLI not found. Install it first.${NC}"
        exit 1
    fi

    # Check terraform
    if ! command -v terraform &> /dev/null; then
        echo -e "${RED}Error: Terraform not found. Install it first.${NC}"
        exit 1
    fi

    # Check python
    if ! command -v python3 &> /dev/null; then
        echo -e "${RED}Error: Python 3 not found. Install it first.${NC}"
        exit 1
    fi

    echo -e "${GREEN}✓ All prerequisites met${NC}"
}

# Get GCP project ID
get_project_id() {
    PROJECT_ID=$(gcloud config get-value project)
    if [ -z "$PROJECT_ID" ]; then
        echo -e "${RED}Error: No GCP project set. Run: gcloud config set project YOUR_PROJECT_ID${NC}"
        exit 1
    fi
    echo -e "${GREEN}Using project: $PROJECT_ID${NC}"
}

# Update terraform.tfvars
update_tfvars() {
    echo -e "${YELLOW}Updating terraform.tfvars...${NC}"

    TFVARS_FILE="terraform/terraform.tfvars"

    # Backup original
    if [ ! -f "${TFVARS_FILE}.bak" ]; then
        cp "$TFVARS_FILE" "${TFVARS_FILE}.bak"
    fi

    # Update project ID
    sed -i "s/gcp_project_id = .*/gcp_project_id = \"$PROJECT_ID\"/" "$TFVARS_FILE"

    echo -e "${GREEN}✓ Updated terraform.tfvars${NC}"
}

# Deploy Terraform
deploy_terraform() {
    echo -e "${YELLOW}Deploying Terraform infrastructure...${NC}"

    cd terraform

    # Initialize
    terraform init

    # Validate
    if ! terraform validate; then
        echo -e "${RED}Terraform validation failed${NC}"
        exit 1
    fi

    # Plan
    terraform plan -out=tfplan

    # Apply
    echo -e "${YELLOW}Ready to apply Terraform plan. Continue? (yes/no)${NC}"
    read -r CONFIRM

    if [ "$CONFIRM" = "yes" ]; then
        terraform apply tfplan
        echo -e "${GREEN}✓ Terraform infrastructure deployed${NC}"

        # Save outputs
        terraform output > terraform-outputs.txt
        echo -e "${GREEN}Outputs saved to terraform-outputs.txt${NC}"
    else
        echo -e "${YELLOW}Terraform deployment cancelled${NC}"
        rm tfplan
        exit 0
    fi

    cd ..
}

# Setup Python environment
setup_python() {
    echo -e "${YELLOW}Setting up Python environment...${NC}"

    cd dataflow-pipeline

    # Create virtual environment
    python3 -m venv venv
    source venv/bin/activate

    # Install dependencies
    pip install --upgrade pip
    pip install -r requirements.txt

    if [ $? -ne 0 ]; then
        echo -e "${RED}Python setup failed${NC}"
        exit 1
    fi

    echo -e "${GREEN}✓ Python environment setup successfully${NC}"

    cd ..
}

# Upload Python files to GCS
upload_pipeline() {
    echo -e "${YELLOW}Uploading pipeline files to GCS...${NC}"

    STAGING_BUCKET="${PROJECT_ID}-dataflow-staging"
    PIPELINE_FILE="dataflow-pipeline/location_pipeline.py"
    REQUIREMENTS_FILE="dataflow-pipeline/requirements.txt"

    if [ ! -f "$PIPELINE_FILE" ]; then
        echo -e "${RED}Pipeline file not found: $PIPELINE_FILE${NC}"
        exit 1
    fi

    if [ ! -f "$REQUIREMENTS_FILE" ]; then
        echo -e "${RED}Requirements file not found: $REQUIREMENTS_FILE${NC}"
        exit 1
    fi

    gsutil cp "$PIPELINE_FILE" "gs://$STAGING_BUCKET/templates/"
    gsutil cp "$REQUIREMENTS_FILE" "gs://$STAGING_BUCKET/templates/"

    echo -e "${GREEN}✓ Pipeline files uploaded to gs://$STAGING_BUCKET/templates/${NC}"
}

# Deploy Dataflow job
deploy_dataflow() {
    echo -e "${YELLOW}Deploy Dataflow job now? (yes/no)${NC}"
    read -r DEPLOY_JOB

    if [ "$DEPLOY_JOB" = "yes" ]; then
        echo -e "${YELLOW}Deploying Dataflow job...${NC}"

        STAGING_BUCKET="${PROJECT_ID}-dataflow-staging"
        TEMP_BUCKET="${PROJECT_ID}-dataflow-temp"
        SERVICE_ACCOUNT=$(cd terraform && terraform output -raw dataflow_service_account_email)
        FIRESTORE_DATABASE=$(cd terraform && terraform output -raw firestore_database_name)

        gcloud dataflow jobs run location-streaming-pipeline \
            --region europe-southwest1 \
            --staging-location "gs://$STAGING_BUCKET/staging" \
            --temp-location "gs://$TEMP_BUCKET" \
            --service-account-email "$SERVICE_ACCOUNT" \
            --python-requirements "gs://$STAGING_BUCKET/templates/requirements.txt" \
            "gs://$STAGING_BUCKET/templates/location_pipeline.py" \
            --input_topic "projects/$PROJECT_ID/topics/incoming-location-data" \
            --output_notifications_topic "projects/$PROJECT_ID/topics/notifications" \
            --output_location_topic "projects/$PROJECT_ID/topics/processed-location-data" \
            --firestore_project "$PROJECT_ID" \
            --firestore_database "$FIRESTORE_DATABASE" \
            --firestore_collection "locations"

        if [ $? -eq 0 ]; then
            echo -e "${GREEN}✓ Dataflow job submitted${NC}"
            echo -e "${YELLOW}Monitor job at: https://console.cloud.google.com/dataflow/jobs${NC}"
        else
            echo -e "${RED}Error deploying Dataflow job${NC}"
            exit 1
        fi
    fi
}

# Main flow
main() {
    check_prerequisites
    get_project_id
    update_tfvars
    deploy_terraform
    setup_python
    upload_pipeline
    deploy_dataflow

    echo -e "${GREEN}"
    echo "=== Deployment Complete ==="
    echo ""
    echo "✓ Infrastructure created (Firestore, Pub/Sub, Dataflow)"
    echo "✓ Python pipeline deployed to Google Cloud Dataflow"
    echo ""
    echo "Next steps:"
    echo "1. Monitor Dataflow job:"
    echo "   gcloud dataflow jobs list --region=europe-southwest1"
    echo ""
    echo "2. Send test data to Pub/Sub:"
    echo "   gcloud pubsub topics publish incoming-location-data --message '{\"latitude\": 40.7128, \"longitude\": -74.0060}'"
    echo ""
    echo "3. Check Firestore data:"
    echo "   - Go to Google Cloud Console → Firestore"
    echo "   - Database: $FIRESTORE_DATABASE"
    echo "   - Collection: locations"
    echo ""
    echo "4. View processed data from Pub/Sub:"
    echo "   gcloud pubsub subscriptions pull notifications-subscription --limit=5 --auto-ack"
    echo ""
    echo "Documentation:"
    echo "- Project: README.md"
    echo "- Setup Guide: SETUP.md"
    echo "- Quick Reference: QUICKREF.md"
    echo "- Terraform: terraform/README.md"
    echo "- Dataflow Pipeline: dataflow-pipeline/README.md"
    echo -e "${NC}"
}

main
