FROM docker.io/nginxinc/nginx-unprivileged:1.30.4-alpine@sha256:bc69cfff69f75aef06daeda8dea70de95fa9ad97a03fe134cd4e5e6789d51124

ARG VCS_REF

LABEL org.opencontainers.image.source="https://github.com/Silence-Among-Crows/LazyLinear" \
    org.opencontainers.image.revision="${VCS_REF}" \
    org.opencontainers.image.title="LazyLinear landing page"

COPY --chown=101:101 deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --chown=101:101 docs/ /usr/share/nginx/html/

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD ["wget", "-q", "-O", "/dev/null", "http://127.0.0.1:8080/healthz"]