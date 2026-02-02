import setuptools

setuptools.setup(
    name='location-dataflow-pipeline',
    version='1.0.0',
    description='Location data streaming pipeline with Apache Beam',
    author='Your Name',
    author_email='your.email@example.com',
    packages=setuptools.find_packages(),
    install_requires=[
        'apache-beam[gcp]==2.55.0',
        'google-cloud-pubsub==1.15.0',
        'google-cloud-firestore==2.14.0',
        'python-json-logger==2.0.7',
    ],
    python_requires='>=3.8',
)
