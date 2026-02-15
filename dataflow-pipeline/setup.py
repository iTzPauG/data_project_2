import setuptools

setuptools.setup(
    name='location-dataflow-pipeline',
    version='1.0.0',
    description='Location data streaming pipeline with Apache Beam',
    author='Your Name',
    author_email='your.email@example.com',
    packages=setuptools.find_packages(),
    install_requires=[
        'apache-beam[gcp]==2.59.0',
        'google-cloud-pubsub==2.21.5',
        'google-cloud-firestore==2.14.0',
        'python-json-logger==2.0.7',
        'psycopg2-binary==2.9.9',
    ],
    python_requires='>=3.8',
)
