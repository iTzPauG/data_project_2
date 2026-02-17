import setuptools

setuptools.setup(
    name='location-dataflow-pipeline',
    version='1.0.0',
    description='Location data streaming pipeline with Apache Beam',
    author='Your Name',
    author_email='your.email@example.com',
    packages=setuptools.find_packages(),
    install_requires=[
        'google-cloud-firestore==2.14.0',
    ],
    python_requires='>=3.8',
)
