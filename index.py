import imaplib
import email
import json
import os
import re
import quopri
from bs4 import BeautifulSoup
from urllib.parse import urlparse

# Directory to store attachments
ATTACHMENT_DIR = "attachments"
os.makedirs(ATTACHMENT_DIR, exist_ok=True)

def clean_text(text):
    if isinstance(text, bytes):
        text = text.decode('utf-8', errors='ignore')

    # Decode quoted-printable encoding safely
    try:
        text = quopri.decodestring(text).decode('utf-8', errors='ignore')
    except Exception:
        pass  # Ignore decoding errors 

    # Remove unicode escape sequences like \u00a0 and \x20 etc.
    text = re.sub(r'(\\u[0-9a-fA-F]{4}|\\x[0-9a-fA-F]{2})', ' ', text)

    # Remove non-breaking spaces and zero-width spaces
    text = re.sub(r'[\u00A0\u200B\u200C\u200D\uFEFF]', ' ', text)

    # Remove non-ASCII control chars except newline
    text = re.sub(r'[^\x20-\x7E\n]', ' ', text)

    # Normalize whitespace (remove extra spaces, tabs, newlines)
    text = re.sub(r'\s+', ' ', text).strip()

    return text

def extract_body(msg):
    body = ""
    if msg.is_multipart():
        # Prefer text/plain over text/html
        plain_text = None
        html_text = None

        for part in msg.walk():
            content_type = part.get_content_type()
            disposition = str(part.get("Content-Disposition"))
            if "attachment" in disposition:
                continue

            if content_type == "text/plain" and plain_text is None:
                try:
                    part_body_bytes = part.get_payload(decode=True)
                    if not part_body_bytes:
                        continue
                    plain_text = part_body_bytes.decode('utf-8', errors="ignore")
                except Exception:
                    continue

            elif content_type == "text/html" and html_text is None:
                try:
                    part_body_bytes = part.get_payload(decode=True)
                    if not part_body_bytes:
                        continue
                    html_part = part_body_bytes.decode('utf-8', errors="ignore")
                    soup = BeautifulSoup(html_part, "html.parser")
                    html_text = soup.get_text(separator="\n")
                except Exception:
                    continue

        if plain_text:
            body = plain_text
        elif html_text:
            body = html_text

    else:
        content_type = msg.get_content_type()
        payload = msg.get_payload(decode=True)
        if payload:
            text = payload.decode('utf-8', errors="ignore")
            if content_type == "text/html":
                body = BeautifulSoup(text, "html.parser").get_text(separator="\n")
            else:
                body = text

    return clean_text(body)


def shorten_links(text):
    def replacer(match):
        url = match.group(0)
        domain = urlparse(url).netloc
        # Markdown style link with domain name as text
        return f"[{domain}]({url})"
    return re.sub(r'https?://[^\s]+', replacer, text)

def save_attachments(msg, email_id):
    # Save attachments locally but don't return any links
    for part in msg.walk():
        if part.get_content_maintype() == 'multipart' or part.get('Content-Disposition') is None:
            continue
        filename = part.get_filename()
        if filename:
            safe_filename = f"{email_id.decode()}_{filename}"
            path = os.path.join(ATTACHMENT_DIR, safe_filename)
            with open(path, "wb") as f:
                f.write(part.get_payload(decode=True))
    # Return empty list or None since you don't want links
    return []

def get_all_emails_list(imap_server, port, username, password, email_folder_name="INBOX"):
    try:
        mail = imaplib.IMAP4_SSL(imap_server, port)
        mail.login(username, password)
        mail.select(email_folder_name)

        result, data = mail.search(None, "ALL")
        email_ids = data[0].split()

        emails = []

        for e_id in email_ids:
            result, msg_data = mail.fetch(e_id, "(RFC822)")
            raw_email = msg_data[0][1]
            msg = email.message_from_bytes(raw_email)

            body = extract_body(msg)
            body = shorten_links(body)

            attachment_links = save_attachments(msg, e_id)

            email_info = {
                "from": msg.get("From"),
                "to": msg.get("To"),
                "subject": msg.get("Subject"),
                "date": msg.get("Date"),
                "body": body,
                "attachments": attachment_links
            }

            emails.append(email_info)

        mail.logout()
        return emails

    except imaplib.IMAP4.error as e:
        print("❌ Login or fetch failed:", e)
        return []

# === Configuration ===
imap_server = 'imap.gmail.com'
port = 993
username = 'juber.innobuzz.in@gmail.com'
password = 'bnit hoiv xfup ecly'
email_folder_name = 'INBOX'

# === Run and Save to JSON ===
all_emails = get_all_emails_list(imap_server, port, username, password, email_folder_name)

if all_emails:
    with open("emails.json", "w", encoding="utf-8") as f:
        json.dump(all_emails, f, indent=4)
    print(f"✅ Saved {len(all_emails)} emails to emails.json")
else:
    print("⚠️ No emails found or failed to fetch.")
