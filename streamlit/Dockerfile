# TrainHub — the Streamlit pilot, one container, for Cloud Run.
#
# The build context is this directory, not the repository root:
#   docker build -t trainhub .
#   gcloud run deploy trainhub --source streamlit --region europe-west3
# so the app lands at /app/app.py and its config at /app/.streamlit/, which is
# where the deploy documented in README.md mounts the secrets file.

FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PORT=8080

WORKDIR /app

# Dependencies before the source: the layer cache then survives every edit to
# the app, and only a change to the pins pays for the install again.
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Everything the app needs and, thanks to .dockerignore, nothing else. That
# file is what keeps a filled-in .streamlit/secrets.toml out of the context and
# therefore out of every layer; see the check below for why it has to be the
# context and not a later cleanup.
COPY . .

# Two things, both about the secrets file:
#
# 1. Cloud Run mounts a secret by mounting a volume over the *directory* that
#    holds it, so /app/.streamlit/secrets.toml hides /app/.streamlit/config.toml
#    and the app would boot themeless. Streamlit also reads ~/.streamlit/config.toml,
#    which no mount covers, so the theme survives from there.
# 2. A developer's own secrets.toml carries the service_role key, which bypasses
#    every RLS policy in the schema. `rm` here would not have removed it from the
#    image: this layer only records a whiteout, while the layer COPY wrote holds
#    the file intact for anyone who runs `docker save | tar x`. .dockerignore is
#    the thing that works, so this asserts it held — a build context that still
#    carries the file fails now, while there is no image yet to push.
RUN mkdir -p /root/.streamlit \
    && cp .streamlit/config.toml /root/.streamlit/config.toml \
    && if [ -e .streamlit/secrets.toml ]; then \
         echo "secrets.toml reached the build context; check streamlit/.dockerignore" >&2; \
         exit 1; \
       fi

EXPOSE 8080

# Shell form so ${PORT} expands: Cloud Run chooses the port and injects it, and
# a hard-coded 8080 is a container that fails its health check the day it does
# not. `exec` puts Streamlit at PID 1 so it receives the SIGTERM of a revision
# being replaced instead of being killed ten seconds later.
#
# --server.fileWatcherType=none: nothing in an image ever changes on disk, and
# the watcher costs an inotify handle per file for a reload that cannot happen.
CMD exec streamlit run app.py \
    --server.port=${PORT:-8080} \
    --server.address=0.0.0.0 \
    --server.headless=true \
    --server.fileWatcherType=none \
    --browser.gatherUsageStats=false
