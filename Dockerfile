FROM python:3.13-slim

WORKDIR /app

# Copy requirements dan install dependencies
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy seluruh kodingan backend
COPY backend/ /app/backend/

# Set environment variable agar Python mendaftarkan backend sebagai root module
ENV PYTHONPATH=/app/backend

EXPOSE 8000

CMD ["python", "-m", "uvicorn", "backend.app.main:app", "--host", "0.0.0.0", "--port", "8000"]