from flask import Flask, request, jsonify
from flask_cors import CORS
from langchain_openai import ChatOpenAI
from langchain_core.messages import HumanMessage, SystemMessage
import os

os.environ["OPENAI_API_KEY"] = "lm-studio"

app = Flask(__name__)
CORS(app)

llm = ChatOpenAI(
    base_url="http://127.0.0.1:1234/v1",
    model="qwen2.5-coder-1.5b-instruct-mlx",
    temperature=0.1,
    max_tokens=30000
)

system_prompt = SystemMessage(content="""
you are an ai Engineer 
""")


@app.route('/chat', methods=['POST'])
def chat():
    data = request.json
    user_message = data.get('message')

    print(f"استلمت رسالة من الموقع: {user_message}")

    user_prompt = HumanMessage(content=user_message)
    messages = [system_prompt, user_prompt]

    response = llm.invoke(messages)

    return jsonify({"reply": response.content})


if __name__ == '__main__':
    print("السيرفر شغال ومستني الموقع يبعت رسائل...")
    app.run(host="0.0.0.0", port=5001, debug=True)