import os

import pdfplumber
import streamlit as st
from docx import Document
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_openai import OpenAIEmbeddings, ChatOpenAI
from langchain_community.vectorstores import FAISS
from langchain_core.output_parsers import StrOutputParser
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.runnables import RunnablePassthrough
from dotenv import load_dotenv


load_dotenv()


OPENROUTER_API_KEY = "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"
OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"
OPENROUTER_CHAT_MODEL = os.getenv("OPENROUTER_CHAT_MODEL", "openai/gpt-4o-mini")
OPENROUTER_EMBEDDING_MODEL = os.getenv(
    "OPENROUTER_EMBEDDING_MODEL",
    "openai/text-embedding-3-small",
)


def extract_text(uploaded_file) -> str:
    if uploaded_file.type == "application/pdf":
        with pdfplumber.open(uploaded_file) as pdf:
            return "\n".join(page.extract_text() or "" for page in pdf.pages)

    if uploaded_file.type == "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
        document = Document(uploaded_file)
        return "\n".join(paragraph.text for paragraph in document.paragraphs)

    raise ValueError("Unsupported file type")


st.header("My First Chatbot")

if not OPENROUTER_API_KEY:
    st.error(
        "Missing OPENROUTER_API_KEY. Add it to a local .env file or export it in your shell."
    )
    st.code(
        "OPENROUTER_API_KEY=your_key_here\n"
        "OPENROUTER_CHAT_MODEL=openai/gpt-4o-mini\n"
        "OPENROUTER_EMBEDDING_MODEL=openai/text-embedding-3-small"
    )
    st.stop()

with st.sidebar:
    st.title("Your Documents")
    file = st.file_uploader(
        "Upload a PDF or DOCX file and start asking questions",
        type=["pdf", "docx"],
    )

#Extract contents from the file and chunk it
if file is not None:
    text = extract_text(file)

    #Split text into chunks
    text_splitter = RecursiveCharacterTextSplitter(
        separators=["\n\n", "\n", ". ", " ", ""],
        chunk_size=1000,
        chunk_overlap=200
    )
    chunks = text_splitter.split_text(text)
    #st.write(chunks)

    #generating embeddings
    embeddings = OpenAIEmbeddings(
        model=OPENROUTER_EMBEDDING_MODEL,
        api_key=OPENROUTER_API_KEY,
        base_url=OPENROUTER_BASE_URL,
    )

    #store embeddings in vector db
    vector_store = FAISS.from_texts(chunks,embeddings)

    #get user question
    user_question = st.text_input("Type your question here")

    #generate answer
    #question -> embeddings -> similiairty search -> results to LLM -> response (CHAIN)

    def format_docs(docs):
        return "\n\n".join([doc.page_content for doc in docs])

    retriever = vector_store.as_retriever(
        search_type="mmr",
        search_kwargs={"k":4}
    )

    #define the LLM and prompts
    llm = ChatOpenAI(
        model=OPENROUTER_CHAT_MODEL,
        temperature=0.3,
        max_tokens=1000,
        api_key=OPENROUTER_API_KEY,
        base_url=OPENROUTER_BASE_URL,
    )

    #provide the prompts
    prompt = ChatPromptTemplate.from_messages([
        ("system",
         "You are a helpful assistant answering questions about a PDF document.\n\n"
         "Guidelines:\n"
         "1. Provide complete, well-explained answers using the context below.\n"
         "2. Include relevant details, numbers, and explanations to give a thorough response.\n"
         "3. If the context mentions related information, include it to give fuller picture.\n"
         "4. Only use information from the provided context - do not use outside knowledge.\n"
         "5. Summarize long information, ideally in bullets where needed\n"
         "6. If the information is not in the context, say so politely.\n\n"
         "Context:\n{context}"),
        ("human", "{question}")
    ])


    chain = (
            {"context": retriever | format_docs, "question": RunnablePassthrough()}
            | prompt
            | llm
            | StrOutputParser()
    )

    if user_question:
        response = chain.invoke(user_question)
        st.write(response)
