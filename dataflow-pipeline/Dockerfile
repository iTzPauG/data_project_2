FROM apache/beam_python3.11_sdk:2.55.0
COPY . /pipeline
WORKDIR /pipeline
RUN pip install --no-cache-dir -r requirements.txt
ENV FLEX_TEMPLATE_PYTHON_PY_FILE="/pipeline/location_pipeline.py"
ENV FLEX_TEMPLATE_PYTHON_SETUP_FILE="/pipeline/setup.py"
