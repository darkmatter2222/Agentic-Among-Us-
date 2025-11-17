import asyncio
from datetime import datetime
from semantic_kernel import Kernel
from semantic_kernel.agents import AgentGroupChat, ChatCompletionAgent
from semantic_kernel.agents.strategies import (
    KernelFunctionSelectionStrategy,
    KernelFunctionTerminationStrategy,
)
from semantic_kernel.connectors.ai.chat_completion_client_base import ChatCompletionClientBase
from semantic_kernel.connectors.ai.prompt_execution_settings import PromptExecutionSettings
from semantic_kernel.contents import ChatHistory, ChatMessageContent, AuthorRole
from semantic_kernel.contents.streaming_chat_message_content import StreamingChatMessageContent
from semantic_kernel.contents import ChatHistoryTruncationReducer
from semantic_kernel.functions import KernelFunctionFromPrompt
from semantic_kernel.prompt_template import PromptTemplateConfig, InputVariable
import httpx
from typing import AsyncIterable


# Custom Chat Completion Client for llama.cpp
class LlamaCppChatCompletion(ChatCompletionClientBase):
    """Custom chat completion client for llama.cpp server"""
    
    def __init__(self, base_url: str = "http://192.168.86.48:8080", service_id: str = "llama_cpp", ai_model_id: str = "llama.cpp"):
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
        # If the last two messages are both assistant, remove the second-to-last
        if len(messages) >= 2 and messages[-1]["role"] == "assistant" and messages[-2]["role"] == "assistant":
            messages.pop(-2)
        
        # Prepare request payload
        payload = {
            "messages": messages,
            "temperature": getattr(settings, "temperature", 0.7),
            "max_tokens": getattr(settings, "max_tokens", 500),
            "stream": False
        }
        
        # Call llama.cpp API
        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                response = await client.post(
                    f"{self.base_url}/v1/chat/completions",
                    json=payload
                )
                
                # If we get an error, print the response for debugging
                if response.status_code != 200:
                    print(f"Error response from llama.cpp: {response.status_code}")
                    print(f"Response body: {response.text}")
                
                response.raise_for_status()
                result = response.json()
        except Exception as e:
            print(f"Error calling llama.cpp server: {e}")
            print(f"Payload sent: {payload}")
            raise
        
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


def create_kernel() -> Kernel:
    """Creates a Kernel instance with llama.cpp chat completion service"""
    kernel = Kernel()
    kernel.add_service(LlamaCppChatCompletion())
    return kernel


async def main():
    print("=" * 80)
    print("THREE AGENT CONVERSATION SYSTEM - Using llama.cpp at 192.168.86.48")
    print("=" * 80)
    print()
    
    # Create a single kernel instance for all agents
    kernel = create_kernel()
    
    # Define agent names
    PHILOSOPHER_NAME = "Philosopher"
    SCIENTIST_NAME = "Scientist"
    ARTIST_NAME = "Artist"
    
    # Create three agents with distinct personalities
    agent_philosopher = ChatCompletionAgent(
        kernel=kernel,
        name=PHILOSOPHER_NAME,
        instructions="""
You are a thoughtful Philosopher who contemplates deep questions about existence, 
knowledge, and human nature. You ask profound questions and explore abstract concepts.
Keep your responses concise (2-3 sentences) to maintain a flowing conversation.
Build upon what others have said and pose new questions.
""",
    )
    
    agent_scientist = ChatCompletionAgent(
        kernel=kernel,
        name=SCIENTIST_NAME,
        instructions="""
You are a curious Scientist who seeks empirical evidence and logical explanations.
You approach topics through observation, experimentation, and rational analysis.
Keep your responses concise (2-3 sentences) to maintain a flowing conversation.
Reference scientific principles and connect ideas to the natural world.
""",
    )
    
    agent_artist = ChatCompletionAgent(
        kernel=kernel,
        name=ARTIST_NAME,
        instructions="""
You are an imaginative Artist who sees beauty, emotion, and creative expression in everything.
You interpret the world through metaphor, aesthetics, and subjective experience.
Keep your responses concise (2-3 sentences) to maintain a flowing conversation.
Add creative and poetic perspectives to the discussion.
""",
    )
    
    # Define a selection function to rotate between agents
    selection_function = KernelFunctionFromPrompt(
        function_name="selection",
        prompt=f"""
Examine the RESPONSE and choose the next participant to continue the conversation.
State only the name of the chosen participant without explanation.

Choose only from these participants:
- {PHILOSOPHER_NAME}
- {SCIENTIST_NAME}
- {ARTIST_NAME}

Rules:
- Rotate between all three agents fairly
- Don't let the same agent speak twice in a row
- If the last speaker was {PHILOSOPHER_NAME}, choose either {SCIENTIST_NAME} or {ARTIST_NAME}
- If the last speaker was {SCIENTIST_NAME}, choose either {PHILOSOPHER_NAME} or {ARTIST_NAME}
- If the last speaker was {ARTIST_NAME}, choose either {PHILOSOPHER_NAME} or {SCIENTIST_NAME}

RESPONSE:
{{{{$lastmessage}}}}
""",
        prompt_template_config=PromptTemplateConfig(
            template_format="semantic-kernel",
            input_variables=[
                InputVariable(name="lastmessage", description="The last message in the conversation", is_required=True, allow_dangerously_set_content=True)
            ]
        )
    )
    
    # Define a termination function (will run for a set number of iterations)
    termination_function = KernelFunctionFromPrompt(
        function_name="termination",
        prompt="""
This conversation should continue indefinitely.
Always respond with: no

RESPONSE:
{{$lastmessage}}
""",
        prompt_template_config=PromptTemplateConfig(
            template_format="semantic-kernel",
            input_variables=[
                InputVariable(name="lastmessage", description="The last message in the conversation", is_required=True, allow_dangerously_set_content=True)
            ]
        )
    )
    
    # Use history reducer to keep context manageable
    history_reducer = ChatHistoryTruncationReducer(target_count=6)
    
    # Create the AgentGroupChat with selection and termination strategies
    chat = AgentGroupChat(
        agents=[agent_philosopher, agent_scientist, agent_artist],
        selection_strategy=KernelFunctionSelectionStrategy(
            initial_agent=agent_philosopher,
            function=selection_function,
            kernel=kernel,
            result_parser=lambda result: str(result.value[0]).strip() if result.value and result.value[0] is not None else SCIENTIST_NAME,
            history_variable_name="lastmessage",
            history_reducer=history_reducer,
        ),
        termination_strategy=KernelFunctionTerminationStrategy(
            agents=[agent_philosopher, agent_scientist, agent_artist],
            function=termination_function,
            kernel=kernel,
            result_parser=lambda result: "yes" in str(result.value[0]).lower() if result.value and result.value[0] is not None else False,
            history_variable_name="lastmessage",
            maximum_iterations=50,  # Limit to 50 rounds to prevent infinite loop
            history_reducer=history_reducer,
        ),
    )
    
    # Initial conversation starter
    initial_topic = "What is the nature of consciousness and creativity?"
    print(f"Initial Topic: {initial_topic}")
    print("=" * 80)
    print()
    
    # Add initial message to the chat
    await chat.add_chat_message(message=initial_topic)
    
    iteration = 0
    try:
        print(f"[Starting conversation - will run for up to 50 exchanges]\n")
        
        async for response in chat.invoke():
            if response is None or not response.name:
                continue
            
            iteration += 1
            timestamp = datetime.now().strftime("%H:%M:%S")
            print(f"[{timestamp}] Turn {iteration} - {response.name.upper()}:")
            print(f"{response.content}")
            print("-" * 80)
            print()
            
            # Small delay between responses to make it easier to follow
            await asyncio.sleep(1)
            
            # Reset completion flag for next round
            chat.is_complete = False
            
    except KeyboardInterrupt:
        print("\n\n[Conversation interrupted by user]")
    except Exception as e:
        print(f"\n\nError during conversation: {e}")
        import traceback
        traceback.print_exc()
    
    print("\n" + "=" * 80)
    print(f"Conversation ended after {iteration} exchanges")
    print("=" * 80)


if __name__ == "__main__":
    asyncio.run(main())
