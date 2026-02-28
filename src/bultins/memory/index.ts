// struct Archive {
//   uuid: string;
//   content: string;
// }

// struct Memory {
//   uid: string;
//   archive_key: string;
//   // metas
//   created_at: string;
//   updated_at: string;
// }

// struct MemorySearchQuery {
//   query: string;
// }

// struct MemoryFragment {
//   archive_key: string;
//   start_line: number;
//   end_line: number;
// }


// void memory_add(content: string): Promise<void> {
//   const memory = await addMemory(content);
//   console.log(memory);
// }

// void memory_search(): Promise<void> {
//   const memory = await getMemory();
//   console.log(memory);
// }

// memory_read(fragment: MemoryFragment): Promise<void> {
//   const memory = await getMemory(fragment);
//   return content
// }