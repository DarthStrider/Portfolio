<?php

// Settings for this service, read from environment variables set by Docker Compose.
return [
    'mongo_uri' => env('MONGO_URI', 'mongodb://mongo:27017/?replicaSet=rs0'),
    'mongo_db' => env('MONGO_DB', 'catalog_db'),
    'rabbitmq_url' => env('RABBITMQ_URL', 'amqp://guest:guest@rabbitmq:5672/'),
    'jwt_public_key' => env('JWT_PUBLIC_KEY', '/keys/jwt_public.pem'),
    'upload_dir' => env('UPLOAD_DIR', storage_path('app/uploads')),
];
