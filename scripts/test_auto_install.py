#!/usr/bin/env python3
import sys
import requests
from bs4 import BeautifulSoup

def main():
    url = sys.argv[1] if len(sys.argv) > 1 else "https://www.example.com"
    
    print(f"Testing auto-install with URL: {url}")
    print("Dependencies loaded successfully!")
    
    try:
        response = requests.get(url)
        soup = BeautifulSoup(response.text, 'html.parser')
        title = soup.title.string if soup.title else "No title"
        print(f"Page title: {title}")
        print("Test completed successfully!")
    except Exception as e:
        print(f"Error: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()