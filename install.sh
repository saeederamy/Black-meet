#!/bin/bash

# Black Meet Advanced Management Script
REPO_URL="https://github.com/saeederamy/black-meet.git"
INSTALL_DIR="/opt/black-meet"
SERVICE_NAME="black-meet.service"
ENV_FILE="$INSTALL_DIR/.env"
USERS_FILE="$INSTALL_DIR/users.txt"

GREEN="\e[32m"
RED="\e[31m"
YELLOW="\e[33m"
CYAN="\e[36m"
RESET="\e[0m"

function check_root() {
    if [ "$EUID" -ne 0 ]; then
        echo -e "${RED}Please run as root (sudo ./install.sh)${RESET}"
        exit 1
    fi
}

function create_global_command() {
    # ساخت یک میانبر در سیستم تا با زدن black-meet این منو باز شود
    cat <<EOF > /usr/local/bin/black-meet
#!/bin/bash
if [ -f $INSTALL_DIR/install.sh ]; then
    bash $INSTALL_DIR/install.sh
else
    echo "Black Meet is not installed or install.sh is missing."
fi
EOF
    chmod +x /usr/local/bin/black-meet
}

function install_app() {
    echo -e "${YELLOW}--- Black Meet Installation ---${RESET}"
    
    # دریافت اطلاعات اولیه از کاربر
    read -p "Enter Application Port (Default: 8000): " APP_PORT
    APP_PORT=${APP_PORT:-8000}

    read -p "Enter Admin Username (Default: admin): " ADMIN_USER
    ADMIN_USER=${ADMIN_USER:-admin}

    read -p "Enter Admin Password: " ADMIN_PASS
    if [ -z "$ADMIN_PASS" ]; then
        echo -e "${RED}Password cannot be empty! Installation aborted.${RESET}"
        return
    fi

    echo -e "${CYAN}Installing dependencies...${RESET}"
    apt update && apt install -y python3 python3-pip python3-venv git nginx certbot python3-certbot-nginx
    
    if [ ! -d "$INSTALL_DIR" ]; then
        git clone $REPO_URL $INSTALL_DIR
    fi

    cd $INSTALL_DIR
    
    # ذخیره پورت در فایل تنظیمات
    echo "APP_PORT=$APP_PORT" > $ENV_FILE
    
    # ساخت دیتابیس کاربران
    echo "$ADMIN_USER:$ADMIN_PASS:admin" > $USERS_FILE

    python3 -m venv venv
    source venv/bin/activate
    pip install -r requirements.txt

    # ساخت سرویس systemd داینامیک
    cat <<EOF > /etc/systemd/system/$SERVICE_NAME
[Unit]
Description=Black Meet WebRTC Server
After=network.target

[Service]
User=root
WorkingDirectory=$INSTALL_DIR
Environment="PATH=$INSTALL_DIR/venv/bin"
ExecStart=$INSTALL_DIR/venv/bin/uvicorn main:app --host 0.0.0.0 --port $APP_PORT
Restart=always

[Install]
WantedBy=multi-user.target
EOF

    systemctl daemon-reload
    systemctl enable $SERVICE_NAME
    systemctl start $SERVICE_NAME
    
    create_global_command
    
    echo -e "${GREEN}Installation completed!${RESET}"
    echo -e "${GREEN}You can now type '${CYAN}black-meet${GREEN}' anywhere in the terminal to open this menu.${RESET}"
}

function add_user() {
    if [ ! -f "$USERS_FILE" ]; then
        echo -e "${RED}App is not installed yet. Please install first.${RESET}"
        return
    fi

    echo -e "${YELLOW}--- Add New User ---${RESET}"
    read -p "Enter Username: " NEW_USER
    
    if grep -q "^$NEW_USER:" "$USERS_FILE"; then
        echo -e "${RED}User already exists!${RESET}"
        return
    fi

    read -p "Enter Password: " NEW_PASS
    read -p "Enter Role (admin/user) [Default: user]: " NEW_ROLE
    NEW_ROLE=${NEW_ROLE:-user}

    echo "$NEW_USER:$NEW_PASS:$NEW_ROLE" >> $USERS_FILE
    echo -e "${GREEN}User '$NEW_USER' ($NEW_ROLE) added successfully!${RESET}"
}

function generate_nginx_config() {
    local DOMAIN=$1
    local CERT=$2
    local KEY=$3
    local PORT=$4

    cat <<EOF > /etc/nginx/sites-available/black-meet
server {
    listen 80;
    server_name $DOMAIN;
    return 301 https://\$host\$request_uri;
}

server {
    listen 443 ssl;
    server_name $DOMAIN;

    ssl_certificate $CERT;
    ssl_certificate_key $KEY;

    location / {
        proxy_pass http://127.0.0.1:$PORT;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        
        # WebSocket Support
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
EOF

    ln -sf /etc/nginx/sites-available/black-meet /etc/nginx/sites-enabled/
    nginx -t && systemctl restart nginx
}

function setup_ssl_auto() {
    if [ ! -f "$ENV_FILE" ]; then echo -e "${RED}Not installed!${RESET}"; return; fi
    source $ENV_FILE
    
    read -p "Enter your domain name (e.g., meet.domain.com): " DOMAIN
    
    # ساخت موقت کانفیگ HTTP برای دریافت سرت
    cat <<EOF > /etc/nginx/sites-available/black-meet
server {
    listen 80;
    server_name $DOMAIN;
    location / { proxy_pass http://127.0.0.1:$APP_PORT; }
}
EOF
    ln -sf /etc/nginx/sites-available/black-meet /etc/nginx/sites-enabled/
    systemctl restart nginx
    
    certbot --nginx -d $DOMAIN
    
    # بعد از سرت‌بات، کانفیگ وب‌سوکت‌ها رو دستی اضافه می‌کنیم
    generate_nginx_config "$DOMAIN" "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" "/etc/letsencrypt/live/$DOMAIN/privkey.pem" "$APP_PORT"
    echo -e "${GREEN}Auto SSL Setup Completed!${RESET}"
}

function setup_ssl_manual() {
    if [ ! -f "$ENV_FILE" ]; then echo -e "${RED}Not installed!${RESET}"; return; fi
    source $ENV_FILE

    read -p "Enter your domain name: " DOMAIN
    read -p "Enter absolute path to SSL Certificate (e.g., /root/cert.crt): " CERT_PATH
    read -p "Enter absolute path to SSL Private Key (e.g., /root/private.key): " KEY_PATH

    if [[ ! -f "$CERT_PATH" || ! -f "$KEY_PATH" ]]; then
        echo -e "${RED}Certificate or Key file not found! Check the paths.${RESET}"
        return
    fi

    generate_nginx_config "$DOMAIN" "$CERT_PATH" "$KEY_PATH" "$APP_PORT"
    echo -e "${GREEN}Manual SSL Setup Completed!${RESET}"
}

function show_info() {
    if [ ! -f "$ENV_FILE" ]; then echo -e "${RED}Not installed!${RESET}"; return; fi
    source $ENV_FILE
    
    echo -e "${CYAN}--- Black Meet System Info ---${RESET}"
    echo "Directory: $INSTALL_DIR"
    echo "Application Port: $APP_PORT"
    echo "Global Command: black-meet"
    echo -e "Registered Users: \n$(cat $USERS_FILE | awk -F':' '{print " - " $1 " (" $3 ")"}')"
    echo "Service Status:"
    systemctl is-active $SERVICE_NAME
    echo "------------------------------"
    read -p "Press Enter to continue..."
}

function uninstall_app() {
    read -p "Are you sure you want to completely remove Black Meet? (y/n) " choice
    if [ "$choice" == "y" ]; then
        systemctl stop $SERVICE_NAME
        systemctl disable $SERVICE_NAME
        rm /etc/systemd/system/$SERVICE_NAME
        rm -rf $INSTALL_DIR
        rm /etc/nginx/sites-available/black-meet
        rm /etc/nginx/sites-enabled/black-meet
        rm -f /usr/local/bin/black-meet
        systemctl daemon-reload
        systemctl restart nginx
        echo -e "${RED}App completely uninstalled.${RESET}"
    fi
}

check_root

while true; do
    clear
    echo -e "${GREEN}=========================================${RESET}"
    echo -e "${GREEN}      Black Meet Management Panel        ${RESET}"
    echo -e "${GREEN}=========================================${RESET}"
    echo "1. Install & Configure Service"
    echo "2. Add New User (Admin/User)"
    echo "-----------------------------------------"
    echo "3. Start Service"
    echo "4. Stop Service"
    echo "5. Update App (Git Pull)"
    echo "-----------------------------------------"
    echo "6. Setup SSL (Auto with Certbot)"
    echo "7. Setup SSL (Manual Path)"
    echo "-----------------------------------------"
    echo "8. Show Panel Info"
    echo "9. Full Uninstall"
    echo "0. Exit"
    echo "-----------------------------------------"
    read -p "Enter your choice: " choice

    case $choice in
        1) install_app ; sleep 2 ;;
        2) add_user ; sleep 2 ;;
        3) systemctl start $SERVICE_NAME; echo -e "${GREEN}Started!${RESET}" ; sleep 1 ;;
        4) systemctl stop $SERVICE_NAME; echo -e "${YELLOW}Stopped!${RESET}" ; sleep 1 ;;
        5) cd $INSTALL_DIR && git pull origin main && systemctl restart $SERVICE_NAME; echo -e "${GREEN}Updated!${RESET}" ; sleep 2 ;;
        6) setup_ssl_auto ; sleep 2 ;;
        7) setup_ssl_manual ; sleep 2 ;;
        8) show_info ;;
        9) uninstall_app ; sleep 2 ;;
        0) exit 0 ;;
        *) echo -e "${RED}Invalid option!${RESET}" ; sleep 1 ;;
    esac
done
