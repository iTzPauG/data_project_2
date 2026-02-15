FROM gcr.io/dataflow-templates-base/python311-template-launcher-base
COPY . /template/pipeline
WORKDIR /template/pipeline

# Install dependencies from setup.py instead of requirements.txt
RUN pip install --no-cache-dir .

ENV FLEX_TEMPLATE_PYTHON_PY_FILE="/template/pipeline/location_pipeline.py"
ENV FLEX_TEMPLATE_PYTHON_SETUP_FILE="/template/pipeline/setup.py"
