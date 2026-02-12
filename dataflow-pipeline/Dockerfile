FROM gcr.io/dataflow-templates-base/python3-template-launcher-base:latest
# Copy pipeline code
COPY . /template/pipeline
WORKDIR /template/pipeline

# Install dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Set environment variables for Flex Template launcher
ENV FLEX_TEMPLATE_PYTHON_PY_FILE="/template/pipeline/location_pipeline.py"
ENV FLEX_TEMPLATE_PYTHON_SETUP_FILE="/template/pipeline/setup.py"
