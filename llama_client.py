"""Custom llama.cpp chat completion client for Semantic Kernel."""
import httpx
from typing import AsyncIterable

from semantic_kernel.connectors.ai.chat_completion_client_base import ChatCompletionClientBase
from semantic_kernel.connectors.ai.prompt_execution_settings import PromptExecutionSettings
from semantic_kernel.contents import ChatHistory, ChatMessageContent, AuthorRole
from semantic_kernel.contents.streaming_chat_message_content import StreamingChatMessageContent


class LlamaCppChatCompletion(ChatCompletionClientBase):
    """Custom chat completion client for llama.cpp server.
    
    This client connects to a llama.cpp server to provide chat completions
    for Semantic Kernel agents.
    """
    
    def __init__(self, base_url: str = "http://192.168.86.48:8080", service_id: str = "llama_cpp", ai_model_id: str = "llama.cpp") -> None:
        # Initialize the parent class first
        super().__init__(service_id=service_id, ai_model_id=ai_model_id)
        
        # Store these after calling super().__init__() using object.__setattr__ to bypass Pydantic
        object.__setattr__(self, '_base_url', base_url.rstrip("/"))
        object.__setattr__(self, '_ai_model_id', ai_model_id)
        object.__setattr__(self, '_service_id', service_id)
    
    @property
    def service_id(self) -> str:
        return object.__getattribute__(self, '_service_id')
    
    @property
    def base_url(self) -> str:
        return object.__getattribute__(self, '_base_url')
    
    async def get_chat_message_contents(
        self,
        chat_history: ChatHistory,
        settings: PromptExecutionSettings,
        **kwargs,
    ) -> list[ChatMessageContent]:
        """Get chat message content from llama.cpp"""
        
        # Convert chat history to llama.cpp format
        # Filter out consecutive assistant messages to avoid llama.cpp errors
        messages = []
        last_role = None
        
        for message in chat_history.messages:
            role = "user" if message.role == AuthorRole.USER else "assistant"
            if message.role == AuthorRole.SYSTEM:
                role = "system"
            
            # Skip consecutive assistant messages (llama.cpp doesn't allow this)
            if role == "assistant" and last_role == "assistant":
                continue
                
            messages.append({
                "role": role,
                "content": message.content
            })
            last_role = role
        
        # Ensure we don't end with multiple assistant messages
        if len(messages) >= 2 and messages[-1]["role"] == "assistant" and messages[-2]["role"] == "assistant":
            messages.pop(-2)
        
        # Prepare request payload
        payload = {
            "messages": messages,
            "temperature": getattr(settings, "temperature", 0.7),
            "max_tokens": getattr(settings, "max_tokens", 300),
            "stream": False
        }
        
        # Call llama.cpp API
        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(
                f"{self.base_url}/v1/chat/completions",
                json=payload
            )
            response.raise_for_status()
            result = response.json()
        
        # Extract response
        assistant_message = result["choices"][0]["message"]["content"]
        
        return [ChatMessageContent(
            role=AuthorRole.ASSISTANT,
            content=assistant_message,
            ai_model_id=object.__getattribute__(self, '_ai_model_id')
        )]
    
    async def get_streaming_chat_message_contents(
        self,
        chat_history: ChatHistory,
        settings: PromptExecutionSettings,
        **kwargs,
    ) -> AsyncIterable[list[StreamingChatMessageContent]]:
        """Streaming not implemented for this example"""
        raise NotImplementedError("Streaming not implemented")
