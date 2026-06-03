FROM ubuntu:24.04

RUN apt-get update \
    && apt-get install -y unzip curl bash nginx ca-certificates \
    python3 python3-venv python3-pip \
    vim-tiny \
    net-tools iproute2 iputils-ping dnsutils \
    procps lsof less \
    screen ffmpeg \
    nodejs npm \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json /app/
RUN npm install 

COPY index.js ws.js run.sh /app/
RUN chmod +x /app/run.sh


EXPOSE 3000

CMD ["/bin/bash", "/app/run.sh"]