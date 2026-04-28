from app import app, init_db

init_db()

# Gunicorn looks for "app" by default in this module.

